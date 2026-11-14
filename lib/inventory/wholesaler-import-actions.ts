'use server';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { bindUploadPathToCreator } from '@/lib/documents/storage-path';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';
import {
  createSignedUploadUrl,
  discardStorageObjects,
  headStorageObject,
  readStorageObject,
  uploadStagingPath,
} from '@/lib/storage/r2';
import { uploadRuleFailure, type UploadRule } from '@/lib/storage/upload-rules';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { readAllRows } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import {
  deliveryContentHash,
  guessUnitMapping,
  stagedDeliveryLines,
  type StagedImportLine,
  type WholesalerReportLine,
} from './wholesaler-import-lines';
import {
  confirmAnswerSchema,
  confirmWholesalerImportInputSchema,
  previewAnswerSchema,
  previewWholesalerImportInputSchema,
  WHOLESALER_FILE_CONTENT_TYPE,
  WHOLESALER_IMPORT_MAX_FILE_BYTES,
  wholesalerImportIdInputSchema,
  wholesalerUploadTicketInputSchema,
  type ConfirmWholesalerImportInput,
  type PreviewWholesalerImportInput,
  type WholesalerImportIdInput,
  type WholesalerImportPreview,
  type WholesalerPreviewEffects,
  type WholesalerImportResult,
  type WholesalerUploadTicketInput,
} from './wholesaler-import-schemas';
import {
  readWholesalerDelivery,
  wholesalerReaderInstalled,
  type WholesalerDelivery,
  type WholesalerFile,
} from './wholesaler-reader';

// The wholesaler import's Server Actions (werk-flow/werkflow-planning#375).
// Only Admin and Büro import. The browser uploads a delivery's files through
// signed URLs into the uploader's own staging folder; the preview reads them
// there, parses them with the one reader seam, stages the lines on a batch
// and deletes the files, whatever its outcome. The confirm writes the
// catalog from the staged lines in one database call. No byte passes through
// an action, and no own article or price changes here.

const DELIVERY_RULE: UploadRule = {
  mimeTypes: [WHOLESALER_FILE_CONTENT_TYPE],
  maxSizeBytes: WHOLESALER_IMPORT_MAX_FILE_BYTES,
};
/** Lines per staging call, and how many calls run at once. */
const STAGE_CHUNK_LINES = 2000;
const STAGE_PARALLEL_CALLS = 4;
/** The most rejected lines one report lists; a larger report answers `report_too_large`. */
const REPORT_ROW_CAP = 100_000;

const refusal = writeRefusalFor(new Set(['not_authorized', 'supplier_not_found', 'import_not_found']));

type ManagerContext = { success: true; context: ActionContext };

async function resolveImportManager(): Promise<ManagerContext | { success: false; error: string }> {
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return auth;
}

/** The key of a delivery's file: the organization's import folder, the upload, the uploader, the file's place. */
function deliveryFilePath(context: ActionContext, uploadId: string, index: number): string {
  return bindUploadPathToCreator(`${context.orgId}/wholesaler-imports/${uploadId}/${index}`, context.userId);
}

async function supplierOfOrganization(
  admin: AdminClient,
  organizationId: string,
  supplierId: string,
): Promise<ActionResult> {
  const { data, error } = await admin
    .from('inventory_suppliers')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('id', supplierId)
    .maybeSingle();
  if (error) {
    logError('wholesaler import: supplier read failed', error);
    return { success: false, error: 'load_failed' };
  }
  return data ? { success: true } : { success: false, error: 'supplier_not_found' };
}

/** Signs one upload per file of a delivery, each into the caller's own staging folder. */
export async function createWholesalerImportUploadTicket(
  rawInput: WholesalerUploadTicketInput,
): Promise<ActionResult<{ uploadId: string; uploadUrls: string[]; contentType: string }>> {
  const parsed = wholesalerUploadTicketInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;
  if (!wholesalerReaderInstalled()) return { success: false, error: 'reader_unavailable' };
  for (const file of parsed.data.files) {
    const ruleFailure = uploadRuleFailure(DELIVERY_RULE, WHOLESALER_FILE_CONTENT_TYPE, file.sizeBytes);
    if (ruleFailure) return { success: false, error: ruleFailure };
  }
  const supplier = await supplierOfOrganization(
    createSupabaseAdminClient(),
    auth.context.orgId,
    parsed.data.supplierId,
  );
  if (!supplier.success) return supplier;

  const uploadId = randomUUID();
  try {
    const uploadUrls = await Promise.all(
      parsed.data.files.map((_, index) =>
        createSignedUploadUrl({
          organizationId: auth.context.orgId,
          path: deliveryFilePath(auth.context, uploadId, index),
          contentType: WHOLESALER_FILE_CONTENT_TYPE,
        }),
      ),
    );
    return { success: true, uploadId, uploadUrls, contentType: WHOLESALER_FILE_CONTENT_TYPE };
  } catch (error) {
    logError('createWholesalerImportUploadTicket: signing failed', error);
    return { success: false, error: 'ticket_failed' };
  }
}

/** The delivery's files from the caller's staging folder, or why they cannot be read. */
async function readDeliveryFiles(
  context: ActionContext,
  input: PreviewWholesalerImportInput,
): Promise<ActionResult<{ files: WholesalerFile[] }>> {
  const files: WholesalerFile[] = [];
  for (const [index, name] of input.fileNames.entries()) {
    const path = uploadStagingPath(context.orgId, deliveryFilePath(context, input.uploadId, index));
    try {
      // The signed upload binds no size: the stored size is checked before any byte is read.
      const head = await headStorageObject({ organizationId: context.orgId, path });
      if (!head.exists) return { success: false, error: 'file_missing' };
      const ruleFailure = uploadRuleFailure(DELIVERY_RULE, WHOLESALER_FILE_CONTENT_TYPE, head.sizeBytes);
      if (ruleFailure) return { success: false, error: ruleFailure };
      const bytes = await readStorageObject({ organizationId: context.orgId, path });
      if (bytes.byteLength > WHOLESALER_IMPORT_MAX_FILE_BYTES)
        return { success: false, error: 'file_too_large' };
      files.push({ name, bytes });
    } catch (error) {
      if (error instanceof Error && error.message === 'storage_object_missing')
        return { success: false, error: 'file_missing' };
      logError('previewWholesalerImport: file read failed', error);
      return { success: false, error: 'upload_failed' };
    }
  }
  return { success: true, files };
}

/** Stages the lines in chunks, a few calls at a time; the first failure ends it. */
async function stageLines(
  admin: AdminClient,
  context: ActionContext,
  importId: string,
  lines: readonly StagedImportLine[],
): Promise<ActionResult> {
  const chunks: StagedImportLine[][] = [];
  for (let start = 0; start < lines.length; start += STAGE_CHUNK_LINES) {
    chunks.push(lines.slice(start, start + STAGE_CHUNK_LINES));
  }
  let next = 0;
  let failure: { success: false; error: string } | null = null;
  async function worker(): Promise<void> {
    while (failure === null && next < chunks.length) {
      const chunk = chunks[next];
      next += 1;
      if (!chunk) return;
      const { error } = await admin.rpc(
        'stage_supplier_catalog_import_lines',
        rpcArgs('stage_supplier_catalog_import_lines', {
          p_organization_id: context.orgId,
          p_actor_id: context.userId,
          p_import_id: importId,
          p_lines: chunk satisfies Json,
        }),
      );
      if (error) failure = refusal(error, 'save_failed', 'previewWholesalerImport: staging failed');
    }
  }
  await Promise.all(Array.from({ length: STAGE_PARALLEL_CALLS }, worker));
  return failure ?? { success: true };
}

async function personName(
  admin: AdminClient,
  personId: string | null,
): Promise<ActionResult<{ name: string }>> {
  if (!personId) return { success: true, name: 'Unbekannt' };
  const { data, error } = await admin
    .from('profiles')
    .select('first_name, last_name, email')
    .eq('id', personId)
    .maybeSingle();
  if (error) {
    logError('previewWholesalerImport: profile read failed', error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, name: data ? formatProfileName(data) : 'Unbekannt' };
}

/** Parses the delivery's files with the one reader seam, into the lines the batch stages. */
function parseDelivery(
  files: WholesalerFile[],
): ActionResult<{ delivery: WholesalerDelivery; lines: StagedImportLine[] }> {
  let reading;
  try {
    reading = readWholesalerDelivery(files);
  } catch (error) {
    logError('previewWholesalerImport: delivery unreadable', error);
    return { success: false, error: 'delivery_unreadable' };
  }
  if (!reading.installed) return { success: false, error: 'reader_unavailable' };
  const lines = stagedDeliveryLines(reading.delivery);
  if (lines.length === 0) return { success: false, error: 'delivery_empty' };
  return { success: true, delivery: reading.delivery, lines };
}

/** Opens the batch with the delivery's header and rebate groups and stages its lines; answers the batch. */
async function openStagedImport(
  admin: AdminClient,
  context: ActionContext,
  input: PreviewWholesalerImportInput,
  files: WholesalerFile[],
  { delivery, lines }: { delivery: WholesalerDelivery; lines: StagedImportLine[] },
): Promise<ActionResult<{ importId: string }>> {
  const opened = await admin.rpc(
    'open_supplier_catalog_import',
    rpcArgs('open_supplier_catalog_import', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_supplier_id: input.supplierId,
      p_file_names: input.fileNames,
      p_content_hash: await deliveryContentHash(files),
      p_header: delivery.header && {
        format_version: delivery.header.formatVersion,
        supplier_text: delivery.header.supplierText,
        date: delivery.header.date,
        currency: delivery.header.currency,
      },
      p_rebate_groups: delivery.rebateGroups.map((group) => ({
        rebate_group: group.rebateGroup,
        text: group.text,
        discount: group.discount,
      })),
      p_skipped: delivery.skipped,
    }),
  );
  if (opened.error) return refusal(opened.error, 'save_failed', 'previewWholesalerImport: open failed');
  const importId = opened.data;
  const staged = await stageLines(admin, context, importId, lines);
  if (!staged.success) {
    await abandonImport(admin, context, importId);
    return staged;
  }
  return { success: true, importId };
}

/** The staged batch's effects as the database answers them, with the name of whoever took the delivery over before. */
async function readPreviewEffects(
  admin: AdminClient,
  context: ActionContext,
  importId: string,
): Promise<
  ActionResult<{
    effects: WholesalerPreviewEffects;
    repeat: WholesalerImportPreview['repeat'];
  }>
> {
  const previewed = await admin.rpc(
    'preview_supplier_catalog_import',
    rpcArgs('preview_supplier_catalog_import', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_import_id: importId,
    }),
  );
  if (previewed.error)
    return refusal(previewed.error, 'save_failed', 'previewWholesalerImport: preview failed');
  const answer = previewAnswerSchema.safeParse(previewed.data);
  if (!answer.success) {
    logError('previewWholesalerImport: unexpected answer shape');
    return { success: false, error: 'save_failed' };
  }
  const { repeat: earlier, ...effects } = answer.data;
  if (!earlier) return { success: true, effects, repeat: null };
  const person = await personName(admin, earlier.confirmed_by);
  if (!person.success) return person;
  return { success: true, effects, repeat: { confirmedAt: earlier.confirmed_at, confirmedBy: person.name } };
}

/** The rejected lines the preview lists. */
function rejectedLines(lines: readonly StagedImportLine[]): WholesalerReportLine[] {
  return lines.flatMap((line) =>
    line.kind === 'rejection'
      ? [
          {
            fileName: line.file_name,
            lineNumber: line.line_number,
            articleNumber: line.article_number,
            reason: line.reason ?? 'Die Zeile konnte nicht gelesen werden.',
          },
        ]
      : [],
  );
}

/**
 * Reads the uploaded delivery, stages its lines on a new batch and answers
 * the preview: what each unit text's articles would do to the catalog, the
 * price and deletion effects, rejected lines, and an earlier import of the
 * same delivery. The uploaded files are deleted once read, whatever the outcome.
 */
export async function previewWholesalerImport(
  rawInput: PreviewWholesalerImportInput,
): Promise<ActionResult<{ preview: WholesalerImportPreview }>> {
  const parsed = previewWholesalerImportInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await resolveImportManager();
  if (!auth.success) return auth;
  const { context } = auth;

  const read = await readDeliveryFiles(context, input);
  // The staged lines are what the confirm writes; the files are not needed after this read.
  await discardStorageObjects({
    organizationId: context.orgId,
    paths: input.fileNames.map((_, index) =>
      uploadStagingPath(context.orgId, deliveryFilePath(context, input.uploadId, index)),
    ),
  });
  if (!read.success) return read;
  const parsedDelivery = parseDelivery(read.files);
  if (!parsedDelivery.success) return parsedDelivery;
  const { delivery, lines } = parsedDelivery;

  const admin = createSupabaseAdminClient();
  const opened = await openStagedImport(admin, context, input, read.files, parsedDelivery);
  if (!opened.success) return opened;
  const previewed = await readPreviewEffects(admin, context, opened.importId);
  if (!previewed.success) return previewed;
  const { effects } = previewed;
  return {
    success: true,
    preview: {
      importId: opened.importId,
      delivery: {
        formatVersion: delivery.header?.formatVersion ?? null,
        supplierText: delivery.header?.supplierText ?? null,
        date: delivery.header?.date ?? null,
        fileNames: input.fileNames,
      },
      ...effects,
      suggestedUnits: guessUnitMapping(effects.units.map((unit) => unit.unitText)),
      rejections: rejectedLines(lines),
      rebateGroups: delivery.rebateGroups.length,
      repeat: previewed.repeat,
    },
  };
}

/**
 * Writes a previewed delivery to the supplier's catalog with the office's unit
 * mapping. The batch is the idempotency key: a confirm sent twice writes once
 * and answers the first result again.
 */
export async function confirmWholesalerImport(
  rawInput: ConfirmWholesalerImportInput,
): Promise<ActionResult<{ result: WholesalerImportResult; alreadyConfirmed: boolean }>> {
  const parsed = confirmWholesalerImportInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;

  const { data, error } = await createSupabaseAdminClient().rpc(
    'confirm_supplier_catalog_import',
    rpcArgs('confirm_supplier_catalog_import', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_import_id: parsed.data.importId,
      p_unit_mapping: parsed.data.unitMapping,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'confirmWholesalerImport: confirm failed');
  const answer = confirmAnswerSchema.safeParse(data);
  if (!answer.success) {
    logError('confirmWholesalerImport: unexpected answer shape');
    return { success: false, error: 'save_failed' };
  }
  const { alreadyConfirmed, ...result } = answer.data;
  return { success: true, result, alreadyConfirmed };
}

async function abandonImport(
  admin: AdminClient,
  context: ActionContext,
  importId: string,
): Promise<ActionResult> {
  const { error } = await admin.rpc(
    'abandon_supplier_catalog_import',
    rpcArgs('abandon_supplier_catalog_import', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_import_id: importId,
    }),
  );
  return error ? refusal(error, 'save_failed', 'abandonWholesalerImport: abandon failed') : { success: true };
}

/** Drops a preview the office leaves without confirming; a confirmed import stays as it is. */
export async function abandonWholesalerImport(rawInput: WholesalerImportIdInput): Promise<ActionResult> {
  const parsed = wholesalerImportIdInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;
  return abandonImport(createSupabaseAdminClient(), auth.context, parsed.data.importId);
}

/** The reason a line a confirmed import kept names in its report. */
function reportReason(line: { kind: string; unit_text: string | null; reason: string | null }): string {
  if (line.kind === 'article') return `Die Einheit „${line.unit_text ?? ''}“ ist keiner Einheit zugeordnet.`;
  if (line.kind === 'price') return 'Preisänderung für einen Artikel, der nicht im Katalog steht.';
  return line.reason ?? 'Die Zeile konnte nicht gelesen werden.';
}

/** The lines a confirmed import did not take, with their reasons, for the downloadable report. */
export async function readWholesalerImportReport(
  rawInput: WholesalerImportIdInput,
): Promise<ActionResult<{ lines: WholesalerReportLine[] }>> {
  const parsed = wholesalerImportIdInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const batch = await admin
    .from('inventory_supplier_catalog_imports')
    .select('id')
    .eq('organization_id', auth.context.orgId)
    .eq('id', parsed.data.importId)
    .eq('status', 'confirmed')
    .maybeSingle();
  if (batch.error) {
    logError('readWholesalerImportReport: import read failed', batch.error);
    return { success: false, error: 'load_failed' };
  }
  if (!batch.data) return { success: false, error: 'import_not_found' };

  const rows = await readAllRows(
    (from, to) =>
      admin
        .from('inventory_supplier_catalog_import_lines')
        .select('kind, file_name, line_number, article_number, unit_text, reason')
        .eq('organization_id', auth.context.orgId)
        .eq('import_id', parsed.data.importId)
        .order('ordinal')
        .range(from, to),
    { cap: REPORT_ROW_CAP },
  );
  if (rows.error) {
    logError('readWholesalerImportReport: lines read failed', rows.error);
    return { success: false, error: 'load_failed' };
  }
  if (rows.overflow) return { success: false, error: 'report_too_large' };
  return {
    success: true,
    lines: rows.data.map((line) => ({
      fileName: line.file_name,
      lineNumber: line.line_number,
      articleNumber: line.article_number,
      reason: reportReason(line),
    })),
  };
}
