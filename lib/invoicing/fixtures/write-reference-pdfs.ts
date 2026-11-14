// Writes the reference invoices as ZUGFeRD PDFs for CI's Mustang and veraPDF
// job (.github/workflows/e-invoice-checks.yml): each one to `<out>/valid/`,
// and the broken copies of the first to `<out>/broken/`. Run it with
// `bun --conditions=react-server lib/invoicing/fixtures/write-reference-pdfs.ts <out>`.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderEInvoicePdf } from '@/lib/document-rendering/e-invoice';
import { invoiceDocument } from '@/lib/document-rendering/invoice-layout';

import { calculateInvoice } from '../calculate';
import { checkEn16931 } from '../check-en16931';
import type { InvoiceDraft } from '../model';
import { toEn16931 } from '../to-en16931';
import { withChangedEmbeddedXml, withoutOutputIntent } from './broken-e-invoice-pdfs';
import { REFERENCE_INVOICES } from './reference-invoices';

/** A plain letterhead of the invoice's made-up seller: no logo and no stationery. */
function letterheadOf({ seller, payee }: InvoiceDraft) {
  const address = [...seller.address.lines, `${seller.address.postalCode} ${seller.address.city}`];
  const identifiers = [
    seller.legalRegistrationId,
    seller.vatId && `USt-IdNr. ${seller.vatId}`,
    seller.taxNumber,
  ];
  return {
    sender: { name: seller.name, addressLines: address, logo: null },
    footerColumns: [
      [seller.name, address.join(', ')],
      identifiers.filter((value): value is string => Boolean(value)),
      ...(payee ? [[`IBAN ${payee.iban}`, ...(payee.bic ? [`BIC ${payee.bic}`] : [])]] : []),
    ],
    stationery: null,
  };
}

const out = process.argv[2];
if (!out) throw new Error('Usage: write-reference-pdfs.ts <output directory>');
await mkdir(join(out, 'valid'), { recursive: true });
await mkdir(join(out, 'broken'), { recursive: true });

let first: Uint8Array | null = null;
for (const [name, draft] of Object.entries(REFERENCE_INVOICES)) {
  const invoice = calculateInvoice(draft);
  const xml = toEn16931(invoice);
  const check = await checkEn16931(xml);
  if (!check.valid) throw new Error(`${name} fails the EN 16931 rules: ${JSON.stringify(check.errors)}`);
  const pdf = await renderEInvoicePdf(invoiceDocument(invoice, letterheadOf(draft)), xml);
  first ??= pdf;
  await writeFile(join(out, 'valid', `${name}.pdf`), pdf);
}
if (!first) throw new Error('No reference invoice.');
await writeFile(join(out, 'broken', 'xml-changed-after-embedding.pdf'), await withChangedEmbeddedXml(first));
await writeFile(join(out, 'broken', 'without-output-intent.pdf'), await withoutOutputIntent(first));
process.stdout.write(
  `Wrote ${Object.keys(REFERENCE_INVOICES).length} reference invoices and 2 broken copies to ${out}.\n`,
);
