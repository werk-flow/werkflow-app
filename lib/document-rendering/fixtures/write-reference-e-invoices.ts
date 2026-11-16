// Writes the reference invoices as ZUGFeRD PDFs for CI's Mustang and veraPDF
// job (.github/workflows/e-invoice-checks.yml): each one to `<out>/valid/`,
// two of them again with stationery, and the broken copies of the first to
// `<out>/broken/`. Run it with
// `bun --conditions=react-server lib/document-rendering/fixtures/write-reference-e-invoices.ts <out>`.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { calculateInvoice } from '@/lib/invoicing/calculate';
import { checkEn16931 } from '@/lib/invoicing/check-en16931';
import { withChangedEmbeddedXml, withoutOutputIntent } from '@/lib/invoicing/fixtures/broken-e-invoice-pdfs';
import { REFERENCE_INVOICES } from '@/lib/invoicing/fixtures/reference-invoices';
import type { InvoiceDraft } from '@/lib/invoicing/model';
import { toEn16931 } from '@/lib/invoicing/to-en16931';

import { renderEInvoicePdf } from '../e-invoice';
import { invoiceDocument } from '../invoice-layout';
import type { BusinessDocument } from '../model';

type Letterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'>;

/** A 1 × 1 RGBA PNG: an image stationery page and logo with an alpha channel. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP49OlHAwAJEwNdDFqrdgAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);

/** A stationery PDF that is not PDF/A: its text uses the standard Helvetica, which is never embedded. */
async function nonPdfaStationery(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText('Briefpapier Haustechnik Sonnenberg', {
    x: 40,
    y: 800,
    size: 9,
    font: await pdf.embedFont(StandardFonts.Helvetica),
  });
  return pdf.save();
}

/** A plain letterhead of the invoice's made-up seller: no logo and no stationery. */
function letterheadOf({ seller, payee }: InvoiceDraft): Letterhead {
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

const margins = { topMm: 45, rightMm: 20, bottomMm: 30, leftMm: 25 };

async function render(draft: InvoiceDraft, letterhead: Letterhead): Promise<Uint8Array> {
  const invoice = calculateInvoice(draft);
  const xml = toEn16931(invoice);
  const check = await checkEn16931(xml);
  if (!check.valid)
    throw new Error(`${draft.number} fails the EN 16931 rules: ${JSON.stringify(check.errors)}`);
  return renderEInvoicePdf(invoiceDocument(invoice, letterhead), xml);
}

const out = process.argv[2];
if (!out) throw new Error('Usage: write-reference-e-invoices.ts <output directory>');
await mkdir(join(out, 'valid'), { recursive: true });
await mkdir(join(out, 'broken'), { recursive: true });

for (const [name, draft] of Object.entries(REFERENCE_INVOICES)) {
  await writeFile(join(out, 'valid', `${name}.pdf`), await render(draft, letterheadOf(draft)));
}

// Stationery: an image page and logo are drawn; a stationery PDF gives way to the plain letterhead.
const { STANDARD_RATE_INVOICE, MIXED_RATE_INVOICE } = REFERENCE_INVOICES;
const plain = letterheadOf(MIXED_RATE_INVOICE);
await writeFile(
  join(out, 'valid', 'MIXED_RATE_INVOICE-image-stationery.pdf'),
  await render(MIXED_RATE_INVOICE, {
    ...plain,
    sender: { ...plain.sender, logo: { format: 'png', bytes: PNG } },
    stationery: {
      firstPage: { file: { format: 'png', bytes: PNG }, margins },
      followingPages: { file: { format: 'png', bytes: PNG }, margins },
    },
  }),
);
await writeFile(
  join(out, 'valid', 'STANDARD_RATE_INVOICE-pdf-stationery.pdf'),
  await render(STANDARD_RATE_INVOICE, {
    ...letterheadOf(STANDARD_RATE_INVOICE),
    stationery: {
      firstPage: { file: { format: 'pdf', bytes: await nonPdfaStationery() }, margins },
      followingPages: null,
    },
  }),
);

const first = await render(STANDARD_RATE_INVOICE, letterheadOf(STANDARD_RATE_INVOICE));
await writeFile(join(out, 'broken', 'xml-changed-after-embedding.pdf'), await withChangedEmbeddedXml(first));
await writeFile(join(out, 'broken', 'without-output-intent.pdf'), await withoutOutputIntent(first));
process.stdout.write(`Wrote the reference invoices, two with stationery, and 2 broken copies to ${out}.\n`);
