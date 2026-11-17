'use server';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { getWorkBillingParties } from '@/lib/billing-parties/server';
import { readOfferLetterhead } from '@/lib/company-profile/reads';
import { getCachedMemberships } from '@/lib/data/cached';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { fileDocumentOriginal } from '@/lib/documents/filing';
import { logError } from '@/lib/logging';
import { requireServiceManager, type ServiceManagerContext } from '@/lib/service-cases/manager-context';
import { attemptStoragePath, discardStorageObjects, putStorageObject } from '@/lib/storage/r2';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isConfirmedWriteRefusal } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

import { buildServiceReport } from './build';
import type { ServiceReport } from './model';
import { readVisitReportFacts } from './reads';

// The office's Servicebericht of a completed maintenance visit
// (werk-flow/werkflow-planning#471). The PDF is rendered here, stored under
// the organization's key, registered with its links in one database call and
// then filed through lib/documents/filing.ts. The bytes never return through
// an action: a download signs a URL for the filed document
// (getDocumentSignedUrl), which the assigned employee may use too.

const createSchema = z.object({
  dueWorkId: uuidSchema,
  /** Chosen by the browser per attempt, so a retry answers with the report it registered. */
  reportId: uuidSchema,
  /** The latest report the office saw; null for the first. */
  replacesReportId: uuidSchema.nullable(),
});

const REGISTER_FAILURES = [
  'not_authorized',
  'maintenance_due_not_found',
  'service_report_visit_not_completed',
  'service_report_stale',
  'service_report_idempotency_conflict',
] as const;

/** Files a registered report; a report already filed counts as filed. */
async function fileReport(
  context: ServiceManagerContext,
  documentId: string,
): Promise<ActionResult<object, 'service_report_filing_failed'>> {
  const filed = await fileDocumentOriginal(context.admin, {
    actorId: context.actorId,
    organizationId: context.organizationId,
    documentId,
  });
  if (filed.success || filed.error === 'document_filed') return { success: true };
  return { success: false, error: 'service_report_filing_failed' };
}

/** The organization's name, which stands in for an empty firm name on the letterhead. */
async function organizationName(context: ServiceManagerContext): Promise<string | null> {
  const memberships = await getCachedMemberships(context.actorId);
  return memberships.find((membership) => membership.orgId === context.organizationId)?.name ?? null;
}

/** The PDF of the report with the company's letterhead; the renderer loads only here. */
async function renderReport(
  context: ServiceManagerContext,
  report: ServiceReport,
): Promise<Uint8Array | null> {
  const name = await organizationName(context);
  if (name === null) return null;
  const letterhead = await readOfferLetterhead(
    context.admin,
    { orgId: context.organizationId, isManagerOrAbove: true },
    name,
  );
  if (!letterhead.success) return null;
  const [{ renderBusinessDocument }, { serviceReportDocument }] = await Promise.all([
    import('@/lib/document-rendering/render'),
    import('@/lib/document-rendering/service-report-layout'),
  ]);
  return renderBusinessDocument(serviceReportDocument(report, letterhead.letterhead));
}

/** Stores the PDF, registers it with its links in one call and files it. */
async function storeAndFile(
  context: ServiceManagerContext,
  attempt: z.output<typeof createSchema> & { report: ServiceReport; bytes: Uint8Array },
): Promise<ActionResult<{ reportId: string; documentId: string }>> {
  const { dueWorkId, reportId, replacesReportId, report, bytes } = attempt;
  const storagePath = attemptStoragePath(
    `${context.organizationId}/service-reports/${dueWorkId}/${reportId}.pdf`,
  );
  await putStorageObject({
    organizationId: context.organizationId,
    path: storagePath,
    body: bytes,
    contentType: 'application/pdf',
  });
  // The registration counts up a name the library root already holds.
  const fileName = `Servicebericht ${report.jobNumber ?? report.visitedOn}.pdf`;
  const { data, error } = await context.admin.rpc(
    'register_maintenance_service_report',
    rpcArgs('register_maintenance_service_report', {
      p_organization_id: context.organizationId,
      p_actor_id: context.actorId,
      p_report_id: reportId,
      p_maintenance_due_work_id: dueWorkId,
      p_replaces_report_id: replacesReportId,
      p_document_id: randomUUID(),
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_size_bytes: bytes.byteLength,
    }),
  );
  const registered = z
    .object({ reportId: uuidSchema, documentId: uuidSchema, duplicate: z.boolean() })
    .safeParse(data);
  if (error || !registered.success) {
    // A refused registration wrote nothing, so the object is unreferenced; after an unknown outcome it stays.
    if (isConfirmedWriteRefusal(error)) {
      await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
    }
    if (error) logError('createServiceReport: registration failed', error);
    const code = REGISTER_FAILURES.find((value) => error?.message.includes(value));
    return { success: false, error: code ?? 'unexpected_error' };
  }
  // A retry of a committed report answers with its document, which owns another object.
  if (registered.data.duplicate) {
    await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
  }
  const filed = await fileReport(context, registered.data.documentId);
  if (!filed.success) return filed;
  return { success: true, reportId: registered.data.reportId, documentId: registered.data.documentId };
}

/**
 * „Servicebericht erstellen“: a new filed report of a completed visit. Names
 * the latest report the office saw, so a report someone made meanwhile is
 * stale. A latest report whose filing failed is filed instead of made again,
 * and a retry of a committed attempt answers with its report.
 */
export async function createServiceReport(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ reportId: string; documentId: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const { dueWorkId, reportId, replacesReportId } = parsed.data;
  try {
    const read = await readVisitReportFacts(context, dueWorkId);
    if (!read.success) return read;
    const { jobId, latestReport, ...facts } = read.facts;
    // The latest report is finished once filed: one whose filing failed is
    // filed now, and a retry of the attempt that made it answers with it.
    if (latestReport && (!latestReport.filed || latestReport.id === reportId)) {
      const filed = latestReport.filed ? null : await fileReport(context, latestReport.documentId);
      if (filed && !filed.success) return filed;
      return { success: true, reportId: latestReport.id, documentId: latestReport.documentId };
    }
    if ((latestReport?.id ?? null) !== replacesReportId)
      return { success: false, error: 'service_report_stale' };
    const parties = await getWorkBillingParties({ kind: 'job', id: jobId });
    if (!parties.success) return parties;
    const current = parties.parties.versions[0];
    const recipient =
      current?.recipient ?? (current?.auftraggeber && { ...current.auftraggeber, address: null });
    if (!recipient) return { success: false, error: 'service_report_recipient_missing' };
    const report = buildServiceReport({
      ...facts,
      issuedOn: getBusinessTodayIso(),
      recipient,
      site: parties.parties.site,
    });
    const bytes = await renderReport(context, report);
    if (!bytes) return { success: false, error: 'load_failed' };

    return await storeAndFile(context, { dueWorkId, reportId, replacesReportId, report, bytes });
  } catch (error) {
    logError('createServiceReport: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}
