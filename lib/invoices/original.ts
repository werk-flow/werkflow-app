import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { offerLetterhead, type LetterheadFiles } from '@/lib/company-profile/letterhead';
import { COMPANY_FILE_KINDS } from '@/lib/company-profile/profile';
import { readCompanyFile } from '@/lib/company-profile/reads';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { renderEInvoicePdf } from '@/lib/document-rendering/e-invoice';
import { invoiceDocument } from '@/lib/document-rendering/invoice-layout';
import type { BusinessDocument } from '@/lib/document-rendering/model';
import { renderBusinessDocument } from '@/lib/document-rendering/render';
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
import {
  invoiceDraftOf,
  issueFindingsOf,
  type InvoiceCheckFailure,
  type IssueFinding,
  type IssueSnapshot,
} from './issue-model';
import { readInvoiceSettings } from './settings-reads';
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

const HEAD_TOO_TALL: IssueFinding = {
  label:
    'Der Briefkopf lässt keinen Platz für die Positionen: kürze Bestellnummer oder Referenz, oder verkleinere die Ränder des Briefpapiers',
  href: '/einstellungen/dokumente',
};

/** The number and Rechnungsdatum an invoice is checked under and then takes. */
export type NextIssue = { number: string; issueDate: string };

/**
 * The original an invoice takes with its number, checked under that number
 * and date: the EN 16931 rules, then the PDF/A-3 whose head, which prints
 * both, leaves room for the lines. Its bytes when it passes, else what keeps
 * the invoice from its number; null without a Leistungsdatum.
 */
async function checkedIssueOriginal(
  organizationId: string,
  invoice: Parameters<typeof calculatedInvoiceOf>[0] & { recipient: { id: string } },
  snapshot: IssueSnapshot,
  issue: NextIssue,
): Promise<Uint8Array | IssueFinding[] | null> {
  const calculated = calculatedInvoiceOf(invoice, snapshot, issue);
  if (!calculated) return null;
  const xml = toEn16931(calculated);
  const check = await checkEn16931(xml);
  if (!check.valid) return issueFindingsOf(check.errors, invoice.recipient.id);
  const units = invoice.lines.map((line) => line.unit);
  const rendered = await renderInvoicePdf(organizationId, { calculated, units, snapshot }, xml).catch(
    (renderError: unknown) => {
      if (renderError instanceof RangeError) return null;
      throw renderError;
    },
  );
  return rendered ?? [HEAD_TOO_TALL];
}

/** An issue whose checked number another issue took meanwhile is checked again, this often at most in all. */
const ISSUE_ATTEMPTS = 3;

function isMovedNumber(result: ActionResult): boolean {
  return !result.success && result.error === 'invoice_number_moved';
}

/**
 * Checks `invoice` under the number and Berlin day the series gives the next
 * invoice now, stores the original rendered under them, and hands both and
 * the stored original (null when the storage failed) to `issue`, whose
 * database function issues only that number on that day. When
 * it answers `invoice_number_moved` because another issue took the number
 * first, the invoice is checked again under the new one, so no original is
 * ever rendered under a number nobody checked.
 */
export async function issueUnderCheckedNumber<Result extends ActionResult>(
  organizationId: string,
  invoice: Parameters<typeof checkedIssueOriginal>[1],
  snapshot: IssueSnapshot,
  issue: (next: NextIssue, original: StoredOriginal | null) => Promise<Result>,
): Promise<Result | InvoiceCheckFailure | ActionFailure<'invoice_incomplete'>> {
  for (let attempt = 1; ; attempt += 1) {
    const issueDate = getBusinessTodayIso();
    const { nextInvoiceNumber } = await readInvoiceSettings(organizationId);
    if (nextInvoiceNumber === null) {
      // A used-up series has no number to check under, so nothing is checked or stored. The function still
      // answers a retry whose first press took the last number with that issue, before it reads the
      // series, and refuses anything else as invoice_numbers_exhausted.
      const result = await issue({ number: '', issueDate }, null);
      if (attempt >= ISSUE_ATTEMPTS || !isMovedNumber(result)) return result;
      continue;
    }
    const next = { number: nextInvoiceNumber, issueDate };
    const original = await checkedIssueOriginal(organizationId, invoice, snapshot, next);
    if (!original) return { success: false, error: 'invoice_incomplete' };
    if (Array.isArray(original)) return { success: false, error: 'invoice_check_failed', findings: original };
    const stored = await storeCheckedOriginal(
      organizationId,
      { invoiceNumber: next.number, cancels: invoice.cancels },
      original,
    );
    const result = await issue(next, stored);
    if (attempt >= ISSUE_ATTEMPTS || !isMovedNumber(result)) return result;
  }
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

/** The invoice an original is stored for: its number, and whether it is a Stornorechnung. */
type OriginalOf = Pick<IssuedInvoice, 'invoiceNumber' | 'cancels'>;

/** The file name of an invoice's original: a Stornorechnung says so. */
function originalFileName(invoice: OriginalOf): string {
  return `${invoice.cancels ? 'Stornorechnung' : 'Rechnung'} ${invoice.invoiceNumber}.pdf`;
}

/** An original stored under its own document id, not yet registered. */
export type StoredOriginal = {
  documentId: string;
  path: string;
  fileName: string;
  sizeBytes: number;
  contentHash: string;
};

/** Stores the bytes of the original of `invoice` under a new document id. */
async function storeInvoiceOriginal(
  organizationId: string,
  invoice: OriginalOf,
  bytes: Uint8Array,
): Promise<StoredOriginal> {
  const documentId = randomUUID();
  const fileName = originalFileName(invoice);
  const path = buildDocumentStoragePath({ organizationId, documentId, fileName });
  await putStorageObject({ organizationId, path, body: bytes, contentType: 'application/pdf' });
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  return { documentId, path, fileName, sizeBytes: bytes.byteLength, contentHash };
}

/** Stores the checked original; a storage failure leaves the original pending and is logged. */
async function storeCheckedOriginal(
  organizationId: string,
  invoice: OriginalOf,
  bytes: Uint8Array,
): Promise<StoredOriginal | null> {
  try {
    return await storeInvoiceOriginal(organizationId, invoice, bytes);
  } catch (error) {
    logError('issueInvoice: original not stored', error);
    return null;
  }
}

/** Discards a stored original no registration references: refused, or another one registered first. */
export async function discardInvoiceOriginal(organizationId: string, stored: StoredOriginal): Promise<void> {
  await discardStorageObjects({ organizationId, paths: [stored.path] });
}

/**
 * Renders, stores, registers and files the original of an issued invoice;
 * the registration files it in the same transaction. Returns whether it is
 * filed now. The caller established the actor, the organization and the
 * office role.
 */
export async function fileInvoiceOriginalFor(
  admin: AdminClient,
  context: { userId: string; orgId: string },
  invoice: IssuedInvoice,
): Promise<boolean> {
  if (invoice.original?.filed) return true;
  return (await registerOriginal(admin, context, invoice)) !== null;
}

/** Renders and stores the original and registers and files it once; answers the document, or null. */
async function registerOriginal(
  admin: AdminClient,
  context: { userId: string; orgId: string },
  invoice: IssuedInvoice,
): Promise<string | null> {
  const bytes = await renderOriginal(context.orgId, invoice);
  const stored = await storeInvoiceOriginal(context.orgId, invoice, bytes);
  const { data, error } = await admin.rpc('register_invoice_original', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_invoice_id: invoice.id,
    p_document_id: stored.documentId,
    p_storage_path: stored.path,
    p_file_name: stored.fileName,
    p_size_bytes: stored.sizeBytes,
    p_content_hash: stored.contentHash,
  });
  const registered = registeredSchema.safeParse(data);
  if (error || !registered.success) {
    // Refused: nothing references the object. Unknown: the registration may still commit.
    if (isConfirmedWriteRefusal(error)) await discardInvoiceOriginal(context.orgId, stored);
    logError('fileInvoiceOriginal: register_invoice_original failed', error);
    return null;
  }
  if (registered.data.replay) {
    await discardInvoiceOriginal(context.orgId, stored);
    if (registered.data.contentHash !== stored.contentHash) {
      logError('fileInvoiceOriginal: a second rendering differs from the registered original', null);
    }
  }
  return registered.data.documentId;
}
