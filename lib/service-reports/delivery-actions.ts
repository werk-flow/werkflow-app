'use server';

import type { ActionResult } from '@/lib/action-result';
import {
  recordManualDelivery,
  retryDocumentDelivery,
  sendDocument,
  type DeliveryOutcome,
} from '@/lib/delivery/document-delivery';
import { recordManualDeliverySchema, sendDocumentEmailSchema } from '@/lib/delivery/delivery-types';
import { logError } from '@/lib/logging';
import { requireServiceManager, type ServiceManagerContext } from '@/lib/service-cases/manager-context';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

import { deliveryCallerOf, readDeliveryReport } from './delivery';

// „Per E-Mail senden“, „Erneut senden“ and „Als manuell versendet markieren“
// on a Servicebericht, through E2c's delivery (lib/delivery/). Admin and Büro
// only; the attachment is always the report's own filed document, read on
// the server, never one the client names.

const sendServiceReportEmailSchema = sendDocumentEmailSchema.extend({ reportId: uuidSchema });
const markServiceReportSentManuallySchema = recordManualDeliverySchema.extend({ reportId: uuidSchema });
const retryServiceReportDeliverySchema = z.object({
  deliveryId: uuidSchema,
  /** The attempt the office saw failed: a repeated press sends nothing again. */
  expectedAttempt: z.number().int().min(1),
});

/** The caller and the filed document of a report of their organization. */
async function reportDocument(
  reportId: string,
): Promise<ActionResult<{ context: ServiceManagerContext; documentId: string }>> {
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const read = await readDeliveryReport(context, reportId);
  if (!read.success) return read;
  if (!read.report) return { success: false, error: 'service_report_not_found' };
  return { success: true, context, documentId: read.report.document_id };
}

/** Sends the report's filed PDF to one recipient, once per filled form. */
export async function sendServiceReportEmail(
  rawInput: z.input<typeof sendServiceReportEmailSchema>,
): Promise<DeliveryOutcome> {
  const parsed = sendServiceReportEmailSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const target = await reportDocument(input.reportId);
    if (!target.success) return target;
    return await sendDocument(deliveryCallerOf(target.context), {
      attemptKey: input.attemptKey,
      subject: { kind: 'service_report', id: input.reportId },
      documentId: target.documentId,
      recipient: input.recipient,
      emailSubject: input.subject,
      text: input.text,
    });
  } catch (error) {
    logError('sendServiceReportEmail: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** „Erneut senden“: a failed delivery of a report once more, with what it carried. */
export async function retryServiceReportDelivery(
  rawInput: z.input<typeof retryServiceReportDeliverySchema>,
): Promise<DeliveryOutcome> {
  const parsed = retryServiceReportDeliverySchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const context = await requireServiceManager();
    if ('success' in context) return context;
    return await retryDocumentDelivery(deliveryCallerOf(context), {
      id: parsed.data.deliveryId,
      expectedAttempt: parsed.data.expectedAttempt,
    });
  } catch (error) {
    logError('retryServiceReportDelivery: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Records that the office sent the report by post or by hand. */
export async function markServiceReportSentManually(
  rawInput: z.input<typeof markServiceReportSentManuallySchema>,
): Promise<ActionResult> {
  const parsed = markServiceReportSentManuallySchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const target = await reportDocument(input.reportId);
    if (!target.success) return target;
    return await recordManualDelivery(deliveryCallerOf(target.context), {
      attemptKey: input.attemptKey,
      subject: { kind: 'service_report', id: input.reportId },
      documentId: target.documentId,
      note: input.note,
    });
  } catch (error) {
    logError('markServiceReportSentManually: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
