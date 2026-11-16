import { describe, expect, mock, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

import { offerLetterhead } from './letterhead';
import { EMPTY_COMPANY_PROFILE_DETAILS, missingLetterDetails, type CompanyProfileDetails } from './profile';

mock.module('server-only', () => ({}));
const { renderBusinessDocument } = await import('@/lib/document-rendering/render');
const { sampleOffer } = await import('@/lib/document-rendering/sample-offer');

const filled: CompanyProfileDetails = {
  ...EMPTY_COMPANY_PROFILE_DETAILS,
  companyName: 'Haustechnik Sonnenberg GmbH',
  street: 'Sonnenweg 1',
  postalCode: '01234',
  city: 'Sonnenstadt',
  phone: '0123 456789',
  email: 'info@sonnenberg.example',
  registerCourt: 'Amtsgericht Sonnenstadt',
  registerNumber: 'HRB 00000',
  managingDirectors: 'Geschäftsführerin: Erika Musterfrau',
  vatId: 'DE000000000',
  bankName: 'Musterbank',
  iban: 'DE00 0000 0000 0000 0000 00',
  offerOpeningText: 'Guten Tag,\nhier ist unser Angebot.',
  offerClosingText: 'Viele Grüße aus Sonnenstadt',
  offerValidityDays: 14,
};

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
  return text;
}

/** A one-page stationery PDF with a rule across its head. */
async function onePagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage([595, 842]).drawLine({ start: { x: 50, y: 800 }, end: { x: 545, y: 800 } });
  return pdf.save();
}

describe('the company letterhead', () => {
  test('a filled profile names its firm, prints every footer detail and starts the offer with its own texts', async () => {
    const letterhead = offerLetterhead(filled, {}, 'Organisation Sonnenberg');
    expect(letterhead.sender).toEqual({
      name: 'Haustechnik Sonnenberg GmbH',
      addressLines: ['Sonnenweg 1', '01234 Sonnenstadt'],
      logo: null,
    });
    expect(letterhead.footerColumns).toEqual([
      ['Haustechnik Sonnenberg GmbH', 'Sonnenweg 1', '01234 Sonnenstadt'],
      ['Tel. 0123 456789', 'info@sonnenberg.example'],
      ['Amtsgericht Sonnenstadt HRB 00000', 'Geschäftsführerin: Erika Musterfrau', 'USt-IdNr. DE000000000'],
      ['Musterbank', 'IBAN DE00 0000 0000 0000 0000 00'],
    ]);
    const text = await pdfText(await renderBusinessDocument(sampleOffer(letterhead, '2026-11-12')));
    for (const expected of [
      'IBAN DE00 0000 0000 0000 0000 00',
      'Amtsgericht Sonnenstadt HRB 00000',
      'hier ist unser Angebot.',
      'Viele Grüße aus Sonnenstadt',
      '26.11.2026',
    ]) {
      expect(text).toContain(expected);
    }
  });

  test('an empty profile sends under the organization’s name, prints no footer and keeps the sample texts', async () => {
    const letterhead = offerLetterhead(EMPTY_COMPANY_PROFILE_DETAILS, {}, 'Organisation Sonnenberg');
    expect(letterhead.sender.name).toBe('Organisation Sonnenberg');
    expect(letterhead.footerColumns).toEqual([['Organisation Sonnenberg']]);
    expect(letterhead.stationery).toBeNull();
    const text = await pdfText(await renderBusinessDocument(sampleOffer(letterhead, '2026-11-12')));
    expect(text).toContain('Gerne bieten wir die folgenden Leistungen an.');
    expect(text).toContain('12.12.2026');
  });

  test('stationery takes the profile’s margins, and following pages only come with a first page', async () => {
    const page = { format: 'pdf' as const, bytes: await onePagePdf() };
    const withBoth = offerLetterhead(filled, { stationery_first: page, stationery_following: page }, 'X');
    expect(withBoth.stationery?.firstPage.margins).toEqual(filled.firstPageMargins);
    expect(withBoth.stationery?.followingPages?.margins).toEqual(filled.followingPageMargins);
    expect(offerLetterhead(filled, { stationery_following: page }, 'X').stationery).toBeNull();
    // With stationery the paper carries the footer: the PDF prints none of it.
    const text = await pdfText(await renderBusinessDocument(sampleOffer(withBoth, '2026-11-12')));
    expect(text).not.toContain('IBAN');
    expect(text).toContain('Viele Grüße aus Sonnenstadt');
  });

  test('the hint names each detail a business letter usually carries and the profile lacks', () => {
    expect(missingLetterDetails(EMPTY_COMPANY_PROFILE_DETAILS)).toEqual([
      'Firma mit Rechtsform',
      'Anschrift',
      'Registergericht und Registernummer',
      'Geschäftsführung oder Inhaber',
      'Steuernummer oder USt-IdNr.',
      'Bankverbindung',
    ]);
    expect(missingLetterDetails(filled)).toEqual([]);
    expect(missingLetterDetails({ ...filled, registerNumber: '', vatId: '' })).toEqual([
      'Registergericht und Registernummer',
      'Steuernummer oder USt-IdNr.',
    ]);
  });
});
