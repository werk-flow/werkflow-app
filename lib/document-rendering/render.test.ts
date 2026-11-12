import { describe, expect, mock, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';

import type { BusinessDocument, DocumentPosition, DocumentSection, StationeryPage } from './model';

mock.module('server-only', () => ({}));
const { renderBusinessDocument } = await import('./render');
const { sampleOffer } = await import('./sample-offer');

const MM = 72 / 25.4;
const PAGE_HEIGHT = 297 * MM;
const TABLE_HEADER = 'Pos. Bezeichnung Menge Einzelpreis Gesamt';

type TextLine = { text: string; top: number };

/** Each page's text as lines from top to bottom, with each line's distance from the top edge in points. */
async function readPages(bytes: Uint8Array): Promise<TextLine[][]> {
  const pdf = await getDocumentProxy(bytes.slice());
  const pages: TextLine[][] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent();
    const rows = new Map<number, Array<{ x: number; text: string }>>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const x = Number(item.transform[4]);
      const y = Number(item.transform[5]);
      const key = Math.round(y);
      rows.set(key, [...(rows.get(key) ?? []), { x, text: item.str }]);
    }
    pages.push(
      [...rows.entries()]
        .sort(([a], [b]) => b - a)
        .map(([y, parts]) => ({
          top: PAGE_HEIGHT - y,
          text: parts
            .sort((a, b) => a.x - b.x)
            .map((part) => part.text)
            .join(' '),
        })),
    );
  }
  return pages;
}

const pageOf = (pages: TextLine[][], startsWith: string) =>
  pages.findIndex((lines) => lines.some((line) => line.text.startsWith(startsWith)));

const position = (number: string, details: Partial<DocumentPosition> = {}): DocumentPosition => ({
  number,
  text: `Leistung ${number}`,
  description: '',
  quantity: '1',
  unitLabel: 'Stk.',
  unitPriceCents: 10000,
  amountCents: 10000,
  kind: 'standard',
  ...details,
});

const baseDocument = (sections: DocumentSection[]): BusinessDocument => ({
  issuedOn: '2026-11-12',
  sender: {
    name: 'Haustechnik Sonnenberg GmbH',
    addressLines: ['Am Werkhof 3', '54321 Sonnenberg'],
    logo: null,
  },
  recipientLines: [
    'Hausverwaltung Lindenhof GmbH',
    'Erika Musterfrau',
    'Lindenstraße 12',
    '12345 Musterstadt',
  ],
  title: 'Angebot ANG-2026-17',
  metaRows: [
    { label: 'Angebot', value: 'ANG-2026-17' },
    { label: 'Datum', value: '12.11.2026' },
  ],
  openingText: 'Sehr geehrte Frau Musterfrau,\nwir bieten Ihnen an:',
  sections,
  totals: {
    byRate: [
      { rateBasisPoints: 1900, netCents: 100000, vatCents: 19000, grossCents: 119000 },
      { rateBasisPoints: 700, netCents: 10000, vatCents: 700, grossCents: 10700 },
    ],
    netCents: 110000,
    vatCents: 19700,
    grossCents: 129700,
  },
  closingText: 'Mit freundlichen Grüßen\nHaustechnik Sonnenberg GmbH',
  footerColumns: [
    ['Haustechnik Sonnenberg GmbH', 'Am Werkhof 3, 54321 Sonnenberg'],
    ['Musterbank', 'IBAN DE00 0000 0000 0000 0000 00'],
  ],
  stationery: null,
});

const serviceOffer = baseDocument([
  {
    number: '1',
    title: 'Wartung',
    positions: [
      position('1.1', {
        text: 'Wartung Gas-Brennwertgerät',
        quantity: '1.250',
        unitLabel: 'Std.',
        unitPriceCents: 8000,
      }),
      position('1.2', {
        text: 'Dichtungssatz',
        quantity: '100',
        unitLabel: 'Stk.',
        unitPriceCents: 12,
        amountCents: 1200,
      }),
      position('1.3', {
        text: 'Nachlass Stammkunde',
        unitLabel: 'psch.',
        unitPriceCents: -2500,
        amountCents: -2500,
      }),
    ],
    subtotalCents: 108700,
  },
]);

const FILLER =
  'Liefern und montieren nach Herstellervorgabe, inklusive Befestigungsmaterial, Dichtungen und Kleinteilen, Anschluss an die vorhandenen Leitungen, Druckprobe, Spülung und Dokumentation im Arbeitsnachweis.';

const installationSections: DocumentSection[] = Array.from({ length: 5 }, (_, sectionIndex) => {
  const number = String(sectionIndex + 1);
  return {
    number,
    title: `Gewerk ${number}`,
    positions: Array.from({ length: 12 }, (_, index) => {
      const positionNumber = `${number}.${index + 1}`;
      return position(positionNumber, {
        text: `Bauteil ${positionNumber} mit einer längeren Bezeichnung über zwei Zeilen hinweg`,
        description: `Beschreibung ${positionNumber}: ${FILLER.repeat(1 + (index % 4))}`,
      });
    }),
    subtotalCents: 120000,
  };
});
const installationOffer = baseDocument(installationSections);

/** A one-page PDF stationery with a text mark, for the first page. */
async function stationeryPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const page = pdf.addPage([210 * MM, PAGE_HEIGHT]);
  page.drawText('BRIEFPAPIER ERSTE SEITE', {
    x: 25 * MM,
    y: PAGE_HEIGHT - 20 * MM,
    size: 12,
    font: await pdf.embedFont(StandardFonts.Helvetica),
  });
  return pdf.save();
}

/** A one-pixel grey PNG, for the following pages. */
function stationeryPng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 0xf0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const firstStationery: StationeryPage = {
  file: { format: 'pdf', bytes: await stationeryPdf() },
  margins: { topMm: 30, rightMm: 30, bottomMm: 40, leftMm: 30 },
};
const followingStationery: StationeryPage = {
  file: { format: 'png', bytes: stationeryPng() },
  margins: { topMm: 45, rightMm: 30, bottomMm: 40, leftMm: 30 },
};
const stationeryOffer: BusinessDocument = {
  ...installationOffer,
  stationery: { firstPage: firstStationery, followingPages: followingStationery },
};

/** Every page's page number, and the table header on each page that holds a table row. */
function expectPageFrame(pages: TextLine[][]) {
  pages.forEach((lines, index) => {
    expect(lines.map((line) => line.text)).toContain(`Seite ${index + 1} von ${pages.length}`);
    const holdsTableRow = lines.some((line) => /^(\d+\.\d+ |Summe \d)/.test(line.text));
    if (holdsTableRow) expect(lines.map((line) => line.text)).toContain(TABLE_HEADER);
  });
}

/** A position's first line stays with its description's first line, and a subtotal with its section's last position. */
function expectKeepTogether(pages: TextLine[][], sections: DocumentSection[]) {
  for (const section of sections) {
    for (const item of section.positions) {
      expect(pageOf(pages, `${item.number} Bauteil`), item.number).toBe(
        pageOf(pages, `Beschreibung ${item.number}:`),
      );
    }
    const last = section.positions.at(-1);
    expect(pageOf(pages, `Summe ${section.number} `), section.number).toBe(
      pageOf(pages, `${last?.number} Bauteil`),
    );
  }
}

describe('the business document renderer', () => {
  test('a service offer fits one page with negative lines, three-decimal quantities, prices per 100 and two tax rates', async () => {
    const pages = await readPages(await renderBusinessDocument(serviceOffer));
    expect(pages).toHaveLength(1);
    const text = pages[0]?.map((line) => line.text) ?? [];
    expect(text).toContain('Haustechnik Sonnenberg GmbH');
    expect(text).toContain('1.1 Wartung Gas-Brennwertgerät 1,25 Std. 80,00 € 100,00 €');
    expect(text).toContain('1.2 Dichtungssatz 100 Stk. 0,12 € 12,00 €');
    expect(text).toContain('1.3 Nachlass Stammkunde 1 psch. -25,00 € -25,00 €');
    expect(text).toContain('Summe 1 Wartung 1.087,00 €');
    expect(text).toContain('19 % 1.000,00 € 190,00 € 1.190,00 €');
    expect(text).toContain('7 % 100,00 € 7,00 € 107,00 €');
    expect(text).toContain('Gesamt 1.100,00 € 197,00 € 1.297,00 €');
    expect(text.some((line) => line.endsWith('IBAN DE00 0000 0000 0000 0000 00'))).toBe(true);
    expectPageFrame(pages);
  });

  test('an installation offer with five sections and sixty long positions repeats its header and keeps positions and subtotals together', async () => {
    const pages = await readPages(await renderBusinessDocument(installationOffer));
    expect(pages).toHaveLength(17);
    expectPageFrame(pages);
    expectKeepTogether(pages, installationSections);
    // Some page opens with the rest of a description, so the rule is exercised, not avoided by keeping every position whole.
    const continuesDescription = pages.slice(1).some((lines) => {
      const afterHeader = lines[lines.findIndex((line) => line.text === TABLE_HEADER) + 1]?.text ?? '';
      return !/^(\d+(\.\d+)? |Summe )/.test(afterHeader);
    });
    expect(continuesDescription).toBe(true);
    const lastPage = pages.at(-1)?.map((line) => line.text) ?? [];
    expect(lastPage).toContain('Gesamt 1.100,00 € 197,00 € 1.297,00 €');
    expect(lastPage).toContain('Mit freundlichen Grüßen');
  });

  test('stationery lies under the content, and the content keeps to each stationery page’s margins', async () => {
    const pages = await readPages(await renderBusinessDocument(stationeryOffer));
    expect(pages.length).toBeGreaterThan(13);
    expectPageFrame(pages);
    expectKeepTogether(pages, installationSections);
    expect(pages[0]?.map((line) => line.text)).toContain('BRIEFPAPIER ERSTE SEITE');
    // The stationery replaces the drawn letterhead and its footer.
    expect(pages.flat().some((line) => line.text.includes('IBAN'))).toBe(false);
    pages.slice(1).forEach((lines) => {
      for (const line of lines) {
        expect(line.top).toBeGreaterThanOrEqual(followingStationery.margins.topMm * MM);
        expect(line.top).toBeLessThanOrEqual(PAGE_HEIGHT - followingStationery.margins.bottomMm * MM);
      }
    });
    const embedded = await PDFDocument.load(await renderBusinessDocument(stationeryOffer));
    expect(embedded.getPageCount()).toBe(pages.length);
  });

  test('the same document renders to the same bytes', async () => {
    for (const document of [serviceOffer, installationOffer, stationeryOffer]) {
      expect(
        Buffer.from(await renderBusinessDocument(document)).equals(
          Buffer.from(await renderBusinessDocument(document)),
        ),
      ).toBe(true);
    }
  });

  test('the Musterangebot names the organization as sender and adds up', async () => {
    const offer = sampleOffer('Haustechnik Sonnenberg GmbH', '2026-11-12');
    for (const section of offer.sections) {
      const counted = section.positions.filter((item) => item.kind === 'standard');
      expect(counted.reduce((sum, item) => sum + item.amountCents, 0)).toBe(section.subtotalCents);
    }
    expect(offer.sections.reduce((sum, section) => sum + section.subtotalCents, 0)).toBe(
      offer.totals.netCents,
    );
    const pages = await readPages(await renderBusinessDocument(offer));
    expect(pages[0]?.map((line) => line.text)).toContain('Haustechnik Sonnenberg GmbH');
    expect(pages[0]?.map((line) => line.text)).toContain('Gültig bis 12.12.2026');
    expectPageFrame(pages);
  });
});
