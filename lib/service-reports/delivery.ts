import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { readDeliverySender, type DeliveryCaller } from '@/lib/delivery/document-delivery';
import type { DeliveryMailDefaults } from '@/lib/delivery/delivery-types';
import { readRecipientEmail } from '@/lib/delivery/recipient-email';
import { readDocumentDeliveries } from '@/lib/delivery/reads';
import { logError } from '@/lib/logging';
import type { ServiceManagerContext } from '@/lib/service-cases/manager-context';
import { formatGermanDate } from '@/lib/utils';

import type { ServiceReportDelivery } from './types';

// A Servicebericht as E2c's delivery sends it (lib/delivery/): the subject
// `service_report` with the report's own filed document, read on the server
// after the caller's manager check, never a document the client names.
// lock_delivery_document checks the organization again, and that the report
// is still its visit's latest.

/** The delivery's caller, as lib/delivery/ names it, from the verified office context. */
export const deliveryCallerOf = (context: ServiceManagerContext): DeliveryCaller => ({
  userId: context.actorId,
  orgId: context.organizationId,
  isManagerOrAbove: true,
});

type ReportRow = { document_id: string; maintenance_due_work_id: string };

/** The report of the caller's organization; null when there is none. */
export async function readDeliveryReport(
  context: ServiceManagerContext,
  reportId: string,
): Promise<ActionResult<{ report: ReportRow | null }, 'load_failed'>> {
  const { data, error } = await loggedRead(
    'readDeliveryReport: report read failed',
    context.admin
      .from('maintenance_service_reports')
      .select('document_id, maintenance_due_work_id')
      .eq('organization_id', context.organizationId)
      .eq('id', reportId)
      .maybeSingle(),
  );
  if (error) return { success: false, error: 'load_failed' };
  return { success: true, report: data };
}

/**
 * What „Per E-Mail senden“ proposes: the visit job's Ansprechpartner's email,
 * else its customer's, else that customer's main contact's; a subject and a
 * text naming the visit day and the job, signed with the sender's name. A
 * failed read throws.
 */
async function readReportMailDefaults(
  context: ServiceManagerContext,
  report: ReportRow,
): Promise<DeliveryMailDefaults> {
  const due = await loggedRead(
    'readReportMailDefaults: visit read failed',
    context.admin
      .from('maintenance_due_work')
      .select('completed_on, job_id')
      .eq('organization_id', context.organizationId)
      .eq('id', report.maintenance_due_work_id)
      .maybeSingle(),
  );
  if (due.error) throw new Error('report_visit_read_failed');
  const jobId = due.data?.job_id;
  const job = jobId
    ? await loggedRead(
        'readReportMailDefaults: job read failed',
        context.admin
          .from('jobs')
          .select('job_number, client_id, contact_id')
          .eq('organization_id', context.organizationId)
          .eq('id', jobId)
          .maybeSingle(),
      )
    : { data: null, error: null };
  if (job.error) throw new Error('report_job_read_failed');
  const clientId = job.data?.client_id;
  const [recipient, sender] = await Promise.all([
    clientId
      ? readRecipientEmail(context.organizationId, { clientId, contactId: job.data?.contact_id ?? null })
      : '',
    readDeliverySender(deliveryCallerOf(context)),
  ]);
  if (!sender) throw new Error('delivery_sender_read_failed');
  const visit = due.data?.completed_on ? ` vom ${formatGermanDate(due.data.completed_on)}` : '';
  const jobNumber = job.data?.job_number ? ` (Auftrag ${job.data.job_number})` : '';
  return {
    recipient,
    subject: `Servicebericht zur Wartung${visit} – ${sender.name}`,
    text: [
      'Guten Tag,',
      `anbei der Servicebericht zur Wartung${visit}${jobNumber}.`,
      `Mit freundlichen Grüßen\n${sender.name}`,
    ].join('\n\n'),
  };
}

/** The report's deliveries from E2c's reader and what the email form proposes. */
export async function readServiceReportDelivery(
  context: ServiceManagerContext,
  reportId: string,
): Promise<ActionResult<{ delivery: ServiceReportDelivery }, 'load_failed' | 'service_report_not_found'>> {
  const read = await readDeliveryReport(context, reportId);
  if (!read.success) return read;
  if (!read.report) return { success: false, error: 'service_report_not_found' };
  try {
    const [list, defaults] = await Promise.all([
      readDocumentDeliveries(context.organizationId, { kind: 'service_report', id: reportId }),
      readReportMailDefaults(context, read.report),
    ]);
    return { success: true, delivery: { list, defaults } };
  } catch (error) {
    logError('readServiceReportDelivery: read failed', error);
    return { success: false, error: 'load_failed' };
  }
}
