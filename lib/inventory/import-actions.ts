'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type {
  BookInventoryImportInput,
  InventoryImportRepeatInput,
  PreviewInventoryImportInput,
} from './action-inputs';
import {
  bookInventoryImportSchema,
  inventoryImportRepeatSchema,
  previewInventoryImportSchema,
} from './action-schemas';
import type { ImportRowOutcome } from './csv-import';
import {
  cleanText,
  ensureInventoryDefaults,
  importAnswerSchema,
  invalidateInventory,
  inventoryWriteFailure,
  stagedImportRows,
} from './write-support';

// The CSV import's Server Actions: the repeat check, the preview and the
// booking. The rule that creates or matches a row lives once, in the database
// (migration 20261201120000); the preview and the booking both run it. Only
// Admin and Büro import.

async function requireInventoryManager(): Promise<ActionResult<{ context: ActionContext }>> {
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return auth;
}

/** The latest booking of a file with the same content, so the dialog warns before a repeat. */
export async function findInventoryImportRepeat(
  rawInput: InventoryImportRepeatInput,
): Promise<ActionResult<{ repeat: { bookedAt: string; bookedBy: string } | null }>> {
  const parsedInput = inventoryImportRepeatSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { data: batch, error } = await admin
    .from('inventory_import_batches')
    .select('completed_at, created_by')
    .eq('organization_id', auth.context.orgId)
    .eq('content_hash', parsedInput.data.contentHash)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logError('findInventoryImportRepeat: batch read failed', error);
    return { success: false, error: 'load_failed' };
  }
  if (!batch?.completed_at) return { success: true, repeat: null };

  let bookedBy = 'Unbekannt';
  if (batch.created_by) {
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('first_name, last_name, email')
      .eq('id', batch.created_by)
      .maybeSingle();
    if (profileError) {
      logError('findInventoryImportRepeat: profile read failed', profileError);
      return { success: false, error: 'load_failed' };
    }
    if (profile) bookedBy = formatProfileName(profile);
  }
  return { success: true, repeat: { bookedAt: batch.completed_at, bookedBy } };
}

/**
 * Shows what the CSV rows would do without booking them: create or match,
 * unit, Lager and resulting stock per row, or why a row is refused. The rows
 * stay on a draft batch, which `bookInventoryImport` books.
 */
export async function previewInventoryImport(
  rawInput: PreviewInventoryImportInput,
): Promise<ActionResult<{ batchId: string; rows: ImportRowOutcome[] }>> {
  const parsedInput = previewInventoryImportSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  await ensureInventoryDefaults(admin, auth.context);
  const { data, error } = await admin.rpc(
    'preview_inventory_import',
    rpcArgs('preview_inventory_import', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_file_name: cleanText(input.fileName) ?? 'inventar-import.csv',
      p_column_mapping: input.columnMapping,
      p_content_hash: input.contentHash,
      p_mode: input.mode,
      p_rows: stagedImportRows(input.rows),
    }),
  );
  if (error) return inventoryWriteFailure('previewInventoryImport: preview failed', error, 'save_failed');
  const answer = importAnswerSchema.safeParse(data);
  if (!answer.success || !answer.data.batch_id) {
    logError('previewInventoryImport: unexpected answer shape');
    return { success: false, error: 'save_failed' };
  }
  return { success: true, batchId: answer.data.batch_id, rows: answer.data.rows };
}

/**
 * Books a previewed import batch. The batch is the idempotency key: a confirm
 * sent twice books once, and the repeat answers the first booking's rows.
 */
export async function bookInventoryImport(
  rawInput: BookInventoryImportInput,
): Promise<ActionResult<{ alreadyBooked: boolean; rows: ImportRowOutcome[] }>> {
  const parsedInput = bookInventoryImportSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    'book_inventory_import',
    rpcArgs('book_inventory_import', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_import_batch_id: parsedInput.data.batchId,
    }),
  );
  if (error) return inventoryWriteFailure('bookInventoryImport: booking failed', error, 'save_failed');
  const answer = importAnswerSchema.safeParse(data);
  if (!answer.success) {
    logError('bookInventoryImport: unexpected answer shape');
    return { success: false, error: 'save_failed' };
  }

  invalidateInventory();
  return { success: true, alreadyBooked: answer.data.already_booked ?? false, rows: answer.data.rows };
}
