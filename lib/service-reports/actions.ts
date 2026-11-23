'use server';

import type { ActionResult } from '@/lib/action-result';
import { getWorkBillingParties } from '@/lib/billing-parties/server';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { requireServiceManager, type ServiceManagerContext } from '@/lib/service-cases/manager-context';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

import { buildServiceReport } from './build';
import { readAttemptReport, readVisitReportFacts } from './reads';
import { renderServiceReport, storeAndFileServiceReport } from './report-file';

// The office's Servicebericht of a completed maintenance visit
// (werk-flow/werkflow-planning#471). A download signs a URL for the filed
// document (getDocumentSignedUrl), which the assigned employee may use too.

const createSchema = z.object({
  dueWorkId: uuidSchema,
  /** Chosen by the browser per attempt, so a retry answers with the report it registered. */
  reportId: uuidSchema,
  /** The latest report the office saw; null for the first. */
  replacesReportId: uuidSchema.nullable(),
});

/**
 * „Servicebericht erstellen“: a new filed report of a completed visit. Names
 * the latest report the office saw, so a report someone made meanwhile is
 * stale; a retry of an attempt that committed answers with its report.
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
    // A retry of an attempt that committed answers with its report, also after a newer one.
    const attempt = await readAttemptReport(context, dueWorkId, reportId);
    if (!attempt.success) return attempt;
    if (attempt.report)
      return { success: true, reportId: attempt.report.id, documentId: attempt.report.documentId };
    const read = await readVisitReportFacts(context, dueWorkId);
    if (!read.success) return read;
    const { jobId, latestReport, ...facts } = read.facts;
    if ((latestReport?.id ?? null) !== replacesReportId)
      return await staleUnlessCommitted(context, dueWorkId, reportId);
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
    const bytes = await renderServiceReport(context, report);
    if (!bytes) return { success: false, error: 'load_failed' };
    const filed = await storeAndFileServiceReport(context, {
      dueWorkId,
      reportId,
      replacesReportId,
      report,
      bytes,
    });
    if (!filed.success && filed.error === 'service_report_stale')
      return await staleUnlessCommitted(context, dueWorkId, reportId);
    return filed;
  } catch (error) {
    logError('createServiceReport: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * A stale answer, unless this very attempt committed meanwhile: an overlapping
 * retry of the same report sees its own report as the latest one.
 */
async function staleUnlessCommitted(
  context: ServiceManagerContext,
  dueWorkId: string,
  reportId: string,
): Promise<ActionResult<{ reportId: string; documentId: string }>> {
  const attempt = await readAttemptReport(context, dueWorkId, reportId);
  if (!attempt.success) return attempt;
  if (attempt.report)
    return { success: true, reportId: attempt.report.id, documentId: attempt.report.documentId };
  return { success: false, error: 'service_report_stale' };
}
