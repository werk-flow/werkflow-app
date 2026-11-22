import 'server-only';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { readOfferLetterhead } from '@/lib/company-profile/reads';
import { getCachedMemberships } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import type { ServiceManagerContext } from '@/lib/service-cases/manager-context';
import { attemptStoragePath, discardStorageObjects, putStorageObject } from '@/lib/storage/r2';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isConfirmedWriteRefusal } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

import type { ServiceReport } from './model';

// The server-generated file of a Servicebericht: rendered here, stored under
// the organization's key, then registered, linked and filed in one database
// call (register_maintenance_service_report, which files through E9's
// file_document). The bytes never cross a Server Action boundary.

const REGISTER_FAILURES = [
  'not_authorized',
  'maintenance_due_not_found',
  'service_report_visit_not_completed',
  'service_report_stale',
  'service_report_idempotency_conflict',
] as const;

/** The PDF of the report with the company's letterhead; the renderer loads only here. */
export async function renderServiceReport(
  context: ServiceManagerContext,
  report: ServiceReport,
): Promise<Uint8Array | null> {
  // The organization's name stands in for an empty firm name on the letterhead.
  const memberships = await getCachedMemberships(context.actorId);
  const name = memberships.find((membership) => membership.orgId === context.organizationId)?.name;
  if (name === undefined) return null;
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

/** Stores the PDF, then registers, links and files it in one call. */
export async function storeAndFileServiceReport(
  context: ServiceManagerContext,
  attempt: {
    dueWorkId: string;
    reportId: string;
    replacesReportId: string | null;
    report: ServiceReport;
    bytes: Uint8Array;
  },
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
      p_file_name: `Servicebericht ${report.jobNumber ?? report.visitedOn}.pdf`,
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
    if (error) logError('storeAndFileServiceReport: registration failed', error);
    const code = REGISTER_FAILURES.find((value) => error?.message.includes(value));
    return { success: false, error: code ?? 'unexpected_error' };
  }
  // A retry of a committed report answers with its document, which owns another object.
  if (registered.data.duplicate) {
    await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
  }
  return { success: true, reportId: registered.data.reportId, documentId: registered.data.documentId };
}
