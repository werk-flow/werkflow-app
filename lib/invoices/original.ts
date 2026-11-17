import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { offerLetterhead, type LetterheadFiles } from '@/lib/company-profile/letterhead';
import { COMPANY_FILE_KINDS } from '@/lib/company-profile/profile';
import { readCompanyFile } from '@/lib/company-profile/reads';
import { renderEInvoicePdf } from '@/lib/document-rendering/e-invoice';
import { invoiceDocument } from '@/lib/document-rendering/invoice-layout';
import type { BusinessDocument } from '@/lib/document-rendering/model';
import { renderBusinessDocument } from '@/lib/document-rendering/render';
import { fileDocumentOriginal } from '@/lib/documents/filing';
import { buildDocumentStoragePath } from '@/lib/documents/storage-path';
import { unitShortLabelOrStored } from '@/lib/inventory/article-terms-format';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { checkEn16931 } from '@/lib/invoicing/check-en16931';
import type { CalculatedInvoice } from '@/lib/invoicing/model';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import { logError } from '@/lib/logging';
import { discardStorageObjects, putStorageObject } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';
import { isConfirmedWriteRefusal } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { invoiceDraftOf, type IssueSnapshot } from './issue-model';
import type { InvoiceDetail } from './types';

// The original of an issued invoice: the ZUGFeRD PDF/A-3 rendered from the
// invoice and its issue snapshot, registered once and filed in the ten-year
// class, linked to the invoice and its customer. Rendering is deterministic,
// so a retry after any failure stores the same bytes; the number stays.

type Letterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'>;

/** An issued invoice as this module reads it. */
export type IssuedInvoice = InvoiceDetail & {
  invoiceNumber: string;
  issueDate: string;
  snapshot: IssueSnapshot;
};

/** The invoice's calculated model; its totals must be the ones stored at issue. */
export function calculatedInvoiceOf(
  invoice: Pick<IssuedInvoice, keyof Parameters<typeof invoiceDraftOf>[0] | 'grossCents' | 'taxCents'>,
  snapshot: IssueSnapshot,
  issue: { number: string; issueDate: string },
): CalculatedInvoice | null {
  const draft = invoiceDraftOf(invoice, snapshot, issue);
  if (!draft) return null;
  const calculated = calculateInvoice(draft);
  if (
    calculated.totals.grossCents !== invoice.grossCents ||
    calculated.totals.taxCents !== invoice.taxCents
  ) {
    throw new Error('invoice_totals_mismatch');
  }
  return calculated;
}

/** The snapshot's letterhead, its files read as bytes; a missing file throws. */
async function invoiceLetterhead(organizationId: string, snapshot: IssueSnapshot): Promise<Letterhead> {
  const files: LetterheadFiles = {};
  for (const kind of COMPANY_FILE_KINDS) {
    const file = snapshot.files[kind];
    if (file) files[kind] = await readCompanyFile(organizationId, file);
  }
  return offerLetterhead(snapshot.profile, files, snapshot.organizationName);
}

/** The printed document, each line's unit by its German short label. */
function invoicePdfDocument(calculated: CalculatedInvoice, units: readonly string[], letterhead: Letterhead) {
  const document = invoiceDocument(calculated, letterhead);
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      positions: section.positions.map((position, index) => {
        const unit = units[index];
        return unit ? { ...position, unitLabel: unitShortLabelOrStored(unit) } : position;
      }),
    })),
  };
}

/**
 * The invoice as a PDF with the snapshot's letterhead: with `xml` the
 * ZUGFeRD PDF/A-3 that embeds it, without it a plain PDF, as the draft's
 * preview. A head that leaves no room for the lines throws a RangeError.
 */
export async function renderInvoicePdf(
  organizationId: string,
  invoice: { calculated: CalculatedInvoice; units: readonly string[]; snapshot: IssueSnapshot },
  xml: string | null,
): Promise<Uint8Array> {
  const letterhead = await invoiceLetterhead(organizationId, invoice.snapshot);
  const document = invoicePdfDocument(invoice.calculated, invoice.units, letterhead);
  return xml === null ? renderBusinessDocument(document) : renderEInvoicePdf(document, xml);
}

/** The original's bytes: the checked EN 16931 XML inside the PDF/A-3. Throws when the rules refuse it. */
async function renderOriginal(organizationId: string, invoice: IssuedInvoice): Promise<Uint8Array> {
  const calculated = calculatedInvoiceOf(invoice, invoice.snapshot, {
    number: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
  });
  if (!calculated) throw new Error('invoice_incomplete');
  const xml = toEn16931(calculated);
  const check = await checkEn16931(xml);
  if (!check.valid) throw new Error('invoice_check_failed');
  const units = invoice.lines.map((line) => line.unit);
  return renderInvoicePdf(organizationId, { calculated, units, snapshot: invoice.snapshot }, xml);
}

const registeredSchema = z.object({
  documentId: uuidSchema,
  replay: z.boolean(),
  contentHash: z.string().nullable(),
});

/** The file name of an invoice's original. */
function originalFileName(invoiceNumber: string): string {
  return `Rechnung ${invoiceNumber}.pdf`;
}

/**
 * Renders, stores, registers and files the original of an issued invoice; a
 * registered one is only filed. Returns whether it is filed now. The caller
 * established the actor, the organization and the office role.
 */
export async function fileInvoiceOriginalFor(
  admin: AdminClient,
  context: { userId: string; orgId: string },
  invoice: IssuedInvoice,
): Promise<boolean> {
  if (invoice.original?.filed) return true;
  const documentId = invoice.original?.documentId ?? (await registerOriginal(admin, context, invoice));
  if (!documentId) return false;
  const filed = await fileDocumentOriginal(admin, {
    actorId: context.userId,
    organizationId: context.orgId,
    documentId,
  });
  return filed.success || filed.error === 'document_filed';
}

/** Renders and stores the original and registers it once; answers the registered document, or null. */
async function registerOriginal(
  admin: AdminClient,
  context: { userId: string; orgId: string },
  invoice: IssuedInvoice,
): Promise<string | null> {
  const bytes = await renderOriginal(context.orgId, invoice);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const ownDocumentId = randomUUID();
  const fileName = originalFileName(invoice.invoiceNumber);
  const path = buildDocumentStoragePath({
    organizationId: context.orgId,
    documentId: ownDocumentId,
    fileName,
  });
  await putStorageObject({
    organizationId: context.orgId,
    path,
    body: bytes,
    contentType: 'application/pdf',
  });
  const { data, error } = await admin.rpc('register_invoice_original', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_invoice_id: invoice.id,
    p_document_id: ownDocumentId,
    p_storage_path: path,
    p_file_name: fileName,
    p_size_bytes: bytes.byteLength,
    p_content_hash: contentHash,
  });
  const registered = registeredSchema.safeParse(data);
  if (error || !registered.success) {
    // Refused: nothing references the object. Unknown: the registration may still commit.
    if (isConfirmedWriteRefusal(error)) {
      await discardStorageObjects({ organizationId: context.orgId, paths: [path] });
    }
    logError('fileInvoiceOriginal: register_invoice_original failed', error);
    return null;
  }
  if (registered.data.replay) {
    await discardStorageObjects({ organizationId: context.orgId, paths: [path] });
    if (registered.data.contentHash !== contentHash) {
      logError('fileInvoiceOriginal: a second rendering differs from the registered original', null);
    }
  }
  return registered.data.documentId;
}
