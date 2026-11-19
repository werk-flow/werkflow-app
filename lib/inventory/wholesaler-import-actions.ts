'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { ROW_PAGE_SIZE } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { invalidateInventory } from './write-support';
import type { WholesalerReportLine } from './wholesaler-import-lines';
import {
  confirmAnswerSchema,
  confirmWholesalerImportInputSchema,
  openWholesalerImportInputSchema,
  previewAnswerSchema,
  previewWholesalerPricesInputSchema,
  pricesAnswerSchema,
  stageWholesalerImportLinesInputSchema,
  wholesalerImportIdInputSchema,
  wholesalerReportPartInputSchema,
  type ConfirmWholesalerImportInput,
  type OpenWholesalerImportInput,
  type PreviewWholesalerPricesInput,
  type StageWholesalerImportLinesInput,
  type WholesalerImportIdInput,
  type WholesalerImportPreview,
  type WholesalerImportResult,
  type WholesalerPreviewEffects,
  type WholesalerPricePreview,
  type WholesalerReportPartInput,
} from './wholesaler-import-schemas';

// The wholesaler import's Server Actions (werk-flow/werkflow-planning#375).
// Only Admin and Büro import. The browser reads a delivery's files and sends
// only the parsed lines: the open names the delivery and its supplier, each
// stage call adds one part of the lines to the batch, and the preview ends
// the staging and answers the batch's effects, and the price preview answers
// the own articles' price changes for the office's rebates. The confirm
// writes the catalog, the rebates and those prices from the staged lines in
// one database call (werk-flow/werkflow-planning#477). No file byte passes an
// action (decision 0001).

/** The report lines one call answers; the browser asks for parts until none is left. */
const REPORT_PART_LINES = 20_000;

const refusal = writeRefusalFor(
  new Set(['not_authorized', 'supplier_not_found', 'import_not_found', 'prices_changed']),
);

type ManagerContext = { success: true; context: ActionContext };

async function resolveImportManager(): Promise<ManagerContext | ActionFailure> {
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return auth;
}

/**
 * Opens the batch of one delivery of a supplier of the caller's organization,
 * with the delivery's header, rebate groups and the kinds of lines the reader
 * left out. Opening drops the caller's earlier open batch.
 */
export async function openWholesalerImport(
  rawInput: OpenWholesalerImportInput,
): Promise<ActionResult<{ importId: string }>> {
  const parsed = openWholesalerImportInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await resolveImportManager();
  if (!auth.success) return auth;

  const { data, error } = await createSupabaseAdminClient().rpc(
    'open_supplier_catalog_import',
    rpcArgs('open_supplier_catalog_import', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_supplier_id: input.supplierId,
      p_file_names: input.fileNames,
      p_content_hash: input.contentHash,
      p_header: input.header && {
        format_version: input.header.formatVersion,
        supplier_text: input.header.supplierText,
        date: input.header.date,
        currency: input.header.currency,
      },
      p_rebate_groups: input.rebateGroups.map((group) => ({
        rebate_group: group.rebateGroup,
        text: group.text,
        discount: group.discount,
      })),
      p_skipped: input.skipped,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'openWholesalerImport: open failed');
  return { success: true, importId: data };
}

/** Adds one part of a delivery's parsed lines to the caller's open batch. */
export async function stageWholesalerImportLines(
  rawInput: StageWholesalerImportLinesInput,
): Promise<ActionResult> {
  const parsed = stageWholesalerImportLinesInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;

  const { error } = await createSupabaseAdminClient().rpc(
    'stage_supplier_catalog_import_lines',
    rpcArgs('stage_supplier_catalog_import_lines', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_import_id: parsed.data.importId,
      p_lines: parsed.data.lines satisfies Json,
    }),
  );
  return error
    ? refusal(error, 'save_failed', 'stageWholesalerImportLines: staging failed')
    : { success: true };
}

async function importerName(
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

/**
 * Ends the staging of the caller's batch and answers what it would do to the
 * catalog: each unit text's articles, the price and deletion effects, the
 * rejected lines' count, and an earlier import of the same delivery.
 */
export async function previewWholesalerImport(rawInput: WholesalerImportIdInput): Promise<
  ActionResult<{
    effects: WholesalerPreviewEffects;
    repeat: WholesalerImportPreview['repeat'];
  }>
> {
  const parsed = wholesalerImportIdInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const previewed = await admin.rpc(
    'preview_supplier_catalog_import',
    rpcArgs('preview_supplier_catalog_import', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_import_id: parsed.data.importId,
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
  const person = await importerName(admin, earlier.confirmed_by);
  if (!person.success) return person;
  return { success: true, effects, repeat: { confirmedAt: earlier.confirmed_at, confirmedBy: person.name } };
}

/**
 * The own articles' prices a previewed delivery changes, for the office's
 * rebates per rebate group, or with null for the saved rebates and else the
 * delivery's own percentages. Writes nothing.
 */
export async function previewWholesalerPrices(
  rawInput: PreviewWholesalerPricesInput,
): Promise<ActionResult<{ prices: WholesalerPricePreview }>> {
  const parsed = previewWholesalerPricesInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;

  const { data, error } = await createSupabaseAdminClient().rpc(
    'preview_supplier_catalog_import_prices',
    rpcArgs('preview_supplier_catalog_import_prices', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_import_id: parsed.data.importId,
      p_rebates: parsed.data.rebates,
    }),
  );
  // As the other preview steps: a failure says nothing was taken over.
  if (error) return refusal(error, 'save_failed', 'previewWholesalerPrices: price preview failed');
  const answer = pricesAnswerSchema.safeParse(data);
  if (!answer.success) {
    logError('previewWholesalerPrices: unexpected answer shape');
    return { success: false, error: 'save_failed' };
  }
  return { success: true, prices: answer.data };
}

/**
 * Writes a previewed delivery to the supplier's catalog with the office's unit
 * mapping, saves the office's rebates and records each own article's changed
 * price from the delivery's date or today. The batch is the idempotency key:
 * a confirm sent twice writes once and answers the first result again.
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
      p_rebates: parsed.data.rebates,
      p_price_fingerprint: parsed.data.priceFingerprint,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'confirmWholesalerImport: confirm failed');
  const answer = confirmAnswerSchema.safeParse(data);
  if (!answer.success) {
    logError('confirmWholesalerImport: unexpected answer shape');
    return { success: false, error: 'save_failed' };
  }
  const { alreadyConfirmed, ...result } = answer.data;
  // Also for a repeat: the first answer may have been lost before it refreshed the pages.
  if (result.ownPricesChanged > 0) invalidateInventory();
  return { success: true, result, alreadyConfirmed };
}

/** Drops a preview the office leaves without confirming; a confirmed import stays as it is. */
export async function abandonWholesalerImport(rawInput: WholesalerImportIdInput): Promise<ActionResult> {
  const parsed = wholesalerImportIdInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveImportManager();
  if (!auth.success) return auth;
  const { error } = await createSupabaseAdminClient().rpc(
    'abandon_supplier_catalog_import',
    rpcArgs('abandon_supplier_catalog_import', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_import_id: parsed.data.importId,
    }),
  );
  return error ? refusal(error, 'save_failed', 'abandonWholesalerImport: abandon failed') : { success: true };
}

/** The reason a line a confirmed import kept names in its report. */
function reportReason(line: { kind: string; unit_text: string | null; reason: string | null }): string {
  if (line.kind === 'article') return `Die Einheit „${line.unit_text ?? ''}“ ist keiner Einheit zugeordnet.`;
  if (line.kind === 'price') return 'Preisänderung für einen Artikel, der nicht im Katalog steht.';
  return line.reason ?? 'Die Zeile konnte nicht gelesen werden.';
}

/**
 * One part of the lines a confirmed import did not take, with their reasons,
 * for the downloadable report: from the line `from` on, and where the next
 * part starts, or null after the last.
 */
export async function readWholesalerImportReport(
  rawInput: WholesalerReportPartInput,
): Promise<ActionResult<{ lines: WholesalerReportLine[]; next: number | null }>> {
  const parsed = wholesalerReportPartInputSchema.safeParse(rawInput);
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

  // One part of the report per call, in pages the Data API answers whole; the
  // browser asks for the next part until none is left, so every line reaches it.
  const lines: WholesalerReportLine[] = [];
  const start = parsed.data.from;
  for (let from = start; from < start + REPORT_PART_LINES; from += ROW_PAGE_SIZE) {
    const page = await admin
      .from('inventory_supplier_catalog_import_lines')
      .select('kind, file_name, line_number, article_number, unit_text, reason')
      .eq('organization_id', auth.context.orgId)
      .eq('import_id', parsed.data.importId)
      .order('ordinal')
      .range(from, from + ROW_PAGE_SIZE - 1);
    if (page.error) {
      logError('readWholesalerImportReport: lines read failed', page.error);
      return { success: false, error: 'load_failed' };
    }
    lines.push(
      ...page.data.map((line) => ({
        fileName: line.file_name,
        lineNumber: line.line_number,
        articleNumber: line.article_number,
        reason: reportReason(line),
      })),
    );
    if (page.data.length < ROW_PAGE_SIZE) return { success: true, lines, next: null };
  }
  return { success: true, lines, next: start + REPORT_PART_LINES };
}
