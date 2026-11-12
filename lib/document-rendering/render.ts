import 'server-only';

import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFEmbeddedPage, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

import { formatEuroCents, formatQuantity, formatTaxRate } from './format';
import type {
  BusinessDocument,
  DocumentImage,
  DocumentPosition,
  DocumentSection,
  PageMargins,
  StationeryFile,
} from './model';

// The one renderer of generated business documents
// (docs/technical/document-storage-and-access.md). It lays out the plain
// document model on A4 pages and draws them with pdf-lib: no browser, no
// external service. The same model gives the same bytes: fonts, images and
// the PDF's dates all come from the input and the bundled files.

const MM = 72 / 25.4;
const PAGE_WIDTH = 210 * MM;
const PAGE_HEIGHT = 297 * MM;

/** The plain letter's margins; the first page's address field and info block sit where DIN 5008 (form B) puts them. */
const PLAIN_MARGINS: PageMargins = { topMm: 20, rightMm: 20, bottomMm: 15, leftMm: 25 };
const PLAIN_FOOTER_HEIGHT_MM = 17;
const FIRST_PAGE_CONTENT_TOP_MM = 100;
const RETURN_ADDRESS_TOP_MM = 47;
/** Where form B's address field starts; a stationery top margin below it moves the field down. */
const ADDRESS_FIELD_TOP_MM = 45;
/** The narrowest content a page may leave: the table and the info block's values need this much. */
const MINIMUM_CONTENT_WIDTH_MM = 120;
const MINIMUM_INFO_VALUE_WIDTH_MM = 25;
const INFO_BLOCK_LEFT_MM = 125;
const PAGE_NUMBER_SPACE = 8 * MM;

const INK = rgb(0.11, 0.11, 0.13);
const MUTED = rgb(0.38, 0.38, 0.42);
const RULE = rgb(0.72, 0.72, 0.76);

const BODY_SIZE = 9.5;
const BODY_LEADING = 13;
const DESCRIPTION_SIZE = 8.5;
const DESCRIPTION_LEADING = 11.5;
const SMALL_SIZE = 7;
const SMALL_LEADING = 9;

type Fonts = { regular: PDFFont; bold: PDFFont };
/** A page's content area in points, measured from the top left corner. */
type Box = { left: number; right: number; top: number; bottom: number };

/** One unbreakable slice of the flow. `keepWithNext` keeps it on the page of the item after it. */
type FlowItem = {
  height: number;
  keepWithNext: boolean;
  /** A table row: a page that holds one starts its table part with the column header. */
  inTable: boolean;
  draw: (page: PDFPage, top: number, box: Box) => void;
};

type PlacedPage = { header: number | null; items: Array<{ item: FlowItem; top: number }> };

// Read once per server instance; `new URL(…, import.meta.url)` lets the bundler trace the files.
let fontBytes: Promise<[Uint8Array, Uint8Array]> | null = null;

function loadFontBytes(): Promise<[Uint8Array, Uint8Array]> {
  fontBytes ??= Promise.all([
    readFile(new URL('./fonts/Geist-Regular.ttf', import.meta.url)),
    readFile(new URL('./fonts/Geist-SemiBold.ttf', import.meta.url)),
  ]).catch((error: unknown) => {
    fontBytes = null;
    throw error;
  });
  return fontBytes;
}

const pdfY = (top: number, size: number) => PAGE_HEIGHT - top - size;

function drawLeft(
  page: PDFPage,
  text: string,
  x: number,
  top: number,
  font: PDFFont,
  size: number,
  color = INK,
) {
  page.drawText(text, { x, y: pdfY(top, size), size, font, color });
}

function drawRight(page: PDFPage, text: string, right: number, top: number, font: PDFFont, size: number) {
  drawLeft(page, text, right - font.widthOfTextAtSize(text, size), top, font, size);
}

function drawRule(page: PDFPage, left: number, right: number, top: number) {
  page.drawLine({
    start: { x: left, y: PAGE_HEIGHT - top },
    end: { x: right, y: PAGE_HEIGHT - top },
    thickness: 0.5,
    color: RULE,
  });
}

// Measuring with the font's layout is slow; a line's width is the sum of its
// words' widths and spaces, each word measured once per font and size.
const wordWidths = new WeakMap<PDFFont, Map<string, number>>();

function wordWidth(font: PDFFont, size: number, word: string): number {
  let widths = wordWidths.get(font);
  if (!widths) {
    widths = new Map();
    wordWidths.set(font, widths);
  }
  const key = `${size}:${word}`;
  let width = widths.get(key);
  if (width === undefined) {
    width = font.widthOfTextAtSize(word, size);
    widths.set(key, width);
  }
  return width;
}

/** Breaks text into lines no wider than `width`; a line break starts a paragraph, a word too long for a line is cut. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const space = wordWidth(font, size, ' ');
  return text.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    let lineWidth = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const wordSize = wordWidth(font, size, word);
      if (line && lineWidth + space + wordSize <= width) {
        line = `${line} ${word}`;
        lineWidth += space + wordSize;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      // Each cut takes at least one character, so a width narrower than a glyph still ends.
      while (rest.length > 1 && font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
      lineWidth = wordWidth(font, size, rest);
    }
    lines.push(line);
    return lines;
  });
}

/** The table's columns for a content box: number, text, quantity, unit price and amount, the last three right-aligned. */
function columnsOf(box: Box) {
  const amountRight = box.right;
  const priceRight = amountRight - 76;
  const quantityRight = priceRight - 72;
  const textLeft = box.left + 34;
  return {
    numberLeft: box.left,
    textLeft,
    textWidth: quantityRight - 70 - textLeft,
    quantityRight,
    priceRight,
    amountRight,
  };
}

const POSITION_MARKS: Record<DocumentPosition['kind'], string | null> = {
  standard: null,
  bedarf: 'Bedarfsposition',
  alternative: 'Alternativposition',
};

/** A position's head line with its price columns and mark, then one item per description line. */
function positionFlow(
  position: DocumentPosition,
  travelsWithSubtotal: boolean,
  fonts: Fonts,
  textWidth: number,
): FlowItem[] {
  const textLines = wrap(position.text, fonts.regular, BODY_SIZE, textWidth);
  const mark = POSITION_MARKS[position.kind];
  const descriptionLines = position.description.trim()
    ? wrap(position.description, fonts.regular, DESCRIPTION_SIZE, textWidth)
    : [];
  const head: FlowItem = {
    height:
      4 +
      textLines.length * BODY_LEADING +
      (mark ? SMALL_LEADING + 1 : 0) +
      (descriptionLines.length ? 0 : 4),
    // A position never leaves the first line of its description behind.
    keepWithNext: descriptionLines.length > 0 || travelsWithSubtotal,
    inTable: true,
    draw: (page, top, box) => {
      const columns = columnsOf(box);
      const line = top + 4;
      drawLeft(page, position.number, columns.numberLeft, line, fonts.regular, BODY_SIZE);
      textLines.forEach((text, index) =>
        drawLeft(page, text, columns.textLeft, line + index * BODY_LEADING, fonts.regular, BODY_SIZE),
      );
      const quantity = `${formatQuantity(position.quantity)} ${position.unitLabel}`;
      drawRight(page, quantity, columns.quantityRight, line, fonts.regular, BODY_SIZE);
      drawRight(
        page,
        formatEuroCents(position.unitPriceCents),
        columns.priceRight,
        line,
        fonts.regular,
        BODY_SIZE,
      );
      drawRight(
        page,
        formatEuroCents(position.amountCents),
        columns.amountRight,
        line,
        fonts.regular,
        BODY_SIZE,
      );
      if (mark) {
        const markTop = line + textLines.length * BODY_LEADING + 1;
        drawLeft(page, mark, columns.textLeft, markTop, fonts.bold, SMALL_SIZE, MUTED);
      }
    },
  };
  const description = descriptionLines.map(
    (text, index): FlowItem => ({
      height: DESCRIPTION_LEADING + (index === descriptionLines.length - 1 ? 5 : 0),
      keepWithNext: travelsWithSubtotal,
      inTable: true,
      draw: (page, top, box) =>
        drawLeft(page, text, columnsOf(box).textLeft, top, fonts.regular, DESCRIPTION_SIZE, MUTED),
    }),
  );
  return [head, ...description];
}

/** The flow of a section: its heading, its positions and its subtotal. */
function sectionFlow(section: DocumentSection, fonts: Fonts, textWidth: number): FlowItem[] {
  const heading: FlowItem = {
    height: 24,
    keepWithNext: true,
    inTable: true,
    draw: (page, top, box) => {
      const columns = columnsOf(box);
      drawLeft(page, section.number, columns.numberLeft, top + 10, fonts.bold, 10);
      drawLeft(page, section.title, columns.textLeft, top + 10, fonts.bold, 10);
    },
  };
  const subtotal: FlowItem = {
    height: 26,
    keepWithNext: false,
    inTable: true,
    draw: (page, top, box) => {
      const columns = columnsOf(box);
      drawRule(page, columns.textLeft, columns.amountRight, top + 4);
      drawLeft(
        page,
        `Summe ${section.number} ${section.title}`,
        columns.textLeft,
        top + 9,
        fonts.bold,
        BODY_SIZE,
      );
      drawRight(
        page,
        formatEuroCents(section.subtotalCents),
        columns.amountRight,
        top + 9,
        fonts.bold,
        BODY_SIZE,
      );
    },
  };
  // The last position travels with the subtotal, so a subtotal never opens a page alone.
  const positions = section.positions.flatMap((position, index) =>
    positionFlow(position, index === section.positions.length - 1, fonts, textWidth),
  );
  return [heading, ...positions, subtotal];
}

function drawTableHeader(page: PDFPage, top: number, box: Box, fonts: Fonts) {
  const columns = columnsOf(box);
  const size = 8;
  drawLeft(page, 'Pos.', columns.numberLeft, top + 2, fonts.bold, size);
  drawLeft(page, 'Bezeichnung', columns.textLeft, top + 2, fonts.bold, size);
  drawRight(page, 'Menge', columns.quantityRight, top + 2, fonts.bold, size);
  drawRight(page, 'Einzelpreis', columns.priceRight, top + 2, fonts.bold, size);
  drawRight(page, 'Gesamt', columns.amountRight, top + 2, fonts.bold, size);
  drawRule(page, box.left, box.right, top + 14);
}
const TABLE_HEADER_HEIGHT = 18;

/** Text paragraphs as one item per line, so they break between any two lines. */
function paragraphFlow(text: string, font: PDFFont, width: number, spaceBefore: number): FlowItem[] {
  if (!text.trim()) return [];
  return wrap(text, font, BODY_SIZE, width).map((line, index) => ({
    height: BODY_LEADING + (index === 0 ? spaceBefore : 0),
    keepWithNext: false,
    inTable: false,
    draw: (page, top, box) =>
      drawLeft(page, line, box.left, top + (index === 0 ? spaceBefore : 0), font, BODY_SIZE),
  }));
}

/** Net, VAT and gross per tax rate and in total, kept together on one page. */
function totalsFlow(document: BusinessDocument, fonts: Fonts): FlowItem[] {
  const { totals } = document;
  const rows = [
    { cells: ['USt.-Satz', 'Netto', 'USt.', 'Brutto'], font: fonts.bold, size: 8 },
    ...totals.byRate.map((rate) => ({
      cells: [
        formatTaxRate(rate.rateBasisPoints),
        formatEuroCents(rate.netCents),
        formatEuroCents(rate.vatCents),
        formatEuroCents(rate.grossCents),
      ],
      font: fonts.regular,
      size: BODY_SIZE,
    })),
    {
      cells: [
        'Gesamt',
        formatEuroCents(totals.netCents),
        formatEuroCents(totals.vatCents),
        formatEuroCents(totals.grossCents),
      ],
      font: fonts.bold,
      size: BODY_SIZE,
    },
  ];
  return rows.map((row, index) => {
    const isFirst = index === 0;
    const isTotal = index === rows.length - 1;
    const spaceBefore = isFirst ? 14 : isTotal ? 6 : 0;
    return {
      height: spaceBefore + 15,
      keepWithNext: !isTotal,
      inTable: false,
      draw: (page, top, box) => {
        const columns = columnsOf(box);
        const rights = [columns.quantityRight, columns.priceRight, columns.amountRight];
        const baseline = top + spaceBefore + 2;
        if (isTotal)
          drawRule(page, columns.textLeft + columns.textWidth / 2, box.right, top + spaceBefore - 2);
        const [label = '', ...amounts] = row.cells;
        drawLeft(page, label, columns.textLeft + columns.textWidth / 2, baseline, row.font, row.size);
        amounts.forEach((amount, cell) =>
          drawRight(page, amount, rights[cell] ?? box.right, baseline, row.font, row.size),
        );
      },
    };
  });
}

function paginate(items: FlowItem[], boxOf: (pageIndex: number) => Box): PlacedPage[] {
  const pages: PlacedPage[] = [];
  let start = 0;
  while (start < items.length) {
    const box = boxOf(pages.length);
    let top = box.top;
    let header: number | null = null;
    let end = start;
    for (; end < items.length; end += 1) {
      const item = items[end];
      if (!item) break;
      const headerHeight = item.inTable && header === null ? TABLE_HEADER_HEIGHT : 0;
      if (end > start && top + headerHeight + item.height > box.bottom) break;
      if (headerHeight) {
        header = top;
        top += headerHeight;
      }
      top += item.height;
    }
    // Move a chain of kept items to the next page with the item they keep with,
    // unless the chain fills the whole page; then it breaks where it must.
    let cut = end;
    if (end < items.length) {
      while (cut > start && items[cut - 1]?.keepWithNext) cut -= 1;
      // A chain longer than a page breaks inside, but its last item still goes along.
      if (cut === start) cut = items[end - 1]?.keepWithNext && end - 1 > start ? end - 1 : end;
    }
    pages.push(placeItems(items.slice(start, cut), box.top));
    start = cut;
  }
  return pages;
}

function placeItems(items: FlowItem[], top: number): PlacedPage {
  const page: PlacedPage = { header: null, items: [] };
  let cursor = top;
  for (const item of items) {
    if (item.inTable && page.header === null) {
      page.header = cursor;
      cursor += TABLE_HEADER_HEIGHT;
    }
    page.items.push({ item, top: cursor });
    cursor += item.height;
  }
  return page;
}

function boxFromMargins(margins: PageMargins, minimumTopMm: number): Box {
  return {
    left: margins.leftMm * MM,
    right: PAGE_WIDTH - margins.rightMm * MM,
    top: Math.max(margins.topMm, minimumTopMm) * MM,
    bottom: PAGE_HEIGHT - margins.bottomMm * MM - PAGE_NUMBER_SPACE,
  };
}

type Underlay = { kind: 'page'; page: PDFEmbeddedPage } | { kind: 'image'; image: PDFImage };

async function embedImage(pdf: PDFDocument, image: DocumentImage): Promise<PDFImage> {
  return image.format === 'png' ? pdf.embedPng(image.bytes) : pdf.embedJpg(image.bytes);
}

async function embedStationery(pdf: PDFDocument, file: StationeryFile): Promise<Underlay> {
  if (file.format === 'pdf') {
    const [page] = await pdf.embedPdf(file.bytes, [0]);
    if (!page) throw new Error('document_stationery_without_page');
    return { kind: 'page', page };
  }
  return { kind: 'image', image: await embedImage(pdf, file) };
}

function drawUnderlay(page: PDFPage, underlay: Underlay) {
  const full = { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT };
  if (underlay.kind === 'page') page.drawPage(underlay.page, full);
  else page.drawImage(underlay.image, full);
}

/** The plain letterhead: sender name and address top left, the logo top right. */
function drawLetterhead(
  page: PDFPage,
  document: BusinessDocument,
  fonts: Fonts,
  logo: PDFImage | null,
  box: Box,
) {
  drawLeft(page, document.sender.name, box.left, 15 * MM, fonts.bold, 13);
  document.sender.addressLines.forEach((line, index) =>
    drawLeft(page, line, box.left, 15 * MM + 19 + index * 10.5, fonts.regular, 8, MUTED),
  );
  if (!logo) return;
  const scale = Math.min((55 * MM) / logo.width, (22 * MM) / logo.height, 1);
  const width = logo.width * scale;
  const height = logo.height * scale;
  page.drawImage(logo, { x: box.right - width, y: PAGE_HEIGHT - 12 * MM - height, width, height });
}

/**
 * The address field and the info block of the first page (DIN 5008, form B),
 * moved down by `shift` and starting at the content's left edge, so they keep
 * to a stationery page's margins too.
 */
function drawAddressAndInfo(
  page: PDFPage,
  document: BusinessDocument,
  fonts: Fonts,
  box: Box,
  shift: number,
) {
  const returnAddress = [document.sender.name, ...document.sender.addressLines].join(' · ');
  drawLeft(page, returnAddress, box.left, RETURN_ADDRESS_TOP_MM * MM + shift, fonts.regular, 6.5, MUTED);
  document.recipientLines.forEach((line, index) =>
    drawLeft(page, line, box.left, 55 * MM + shift + index * BODY_LEADING, fonts.regular, BODY_SIZE),
  );
  const labelLeft = INFO_BLOCK_LEFT_MM * MM;
  const valueLeft = labelLeft + 30 * MM;
  let top = 50 * MM + shift;
  for (const row of document.metaRows) {
    drawLeft(page, row.label, labelLeft, top, fonts.regular, 8, MUTED);
    const lines = wrap(row.value, fonts.regular, 8, box.right - valueLeft);
    lines.forEach((line, index) => drawLeft(page, line, valueLeft, top + index * 11, fonts.regular, 8));
    top += lines.length * 11 + 2;
  }
}

function drawFooter(page: PDFPage, columns: string[][], fonts: Fonts, box: Box) {
  const width = (box.right - box.left) / Math.max(columns.length, 1);
  const top = PAGE_HEIGHT - (PLAIN_MARGINS.bottomMm + PLAIN_FOOTER_HEIGHT_MM) * MM + 4;
  drawRule(page, box.left, box.right, top - 4);
  columns.forEach((lines, column) =>
    lines.forEach((line, index) =>
      drawLeft(
        page,
        line,
        box.left + column * width,
        top + index * SMALL_LEADING,
        fonts.regular,
        SMALL_SIZE,
        MUTED,
      ),
    ),
  );
}

// Glyphs without kerning, ligatures or contextual forms: shaping each string
// tripled the render time of a long offer, and business print needs none of it.
const PLAIN_GLYPHS = {
  kern: false,
  liga: false,
  calt: false,
  ccmp: false,
  locl: false,
  mark: false,
  mkmk: false,
};

/** The content boxes of the first and the following pages, and how far the address field moves down. */
function pageGeometry(document: BusinessDocument) {
  const { stationery } = document;
  const plainBottomMm = PLAIN_MARGINS.bottomMm + (document.footerColumns.length ? PLAIN_FOOTER_HEIGHT_MM : 0);
  const plainMargins = { ...PLAIN_MARGINS, bottomMm: plainBottomMm };
  const addressShift = Math.max(0, (stationery?.firstPage.margins.topMm ?? 0) - ADDRESS_FIELD_TOP_MM) * MM;
  const firstBox = boxFromMargins(
    stationery?.firstPage.margins ?? plainMargins,
    FIRST_PAGE_CONTENT_TOP_MM + addressShift / MM,
  );
  const followingBox = boxFromMargins(stationery?.followingPages?.margins ?? plainMargins, 0);
  const tooNarrow = [firstBox, followingBox].some(
    (box) => box.right - box.left < MINIMUM_CONTENT_WIDTH_MM * MM || box.bottom - box.top < 50 * MM,
  );
  if (tooNarrow || firstBox.right - (INFO_BLOCK_LEFT_MM + 30) * MM < MINIMUM_INFO_VALUE_WIDTH_MM * MM) {
    throw new Error('document_margins_leave_no_room');
  }
  return { firstBox, followingBox, addressShift };
}

/** Title, opening text, sections, totals and closing text as one flow. */
function documentFlow(
  document: BusinessDocument,
  fonts: Fonts,
  firstBox: Box,
  followingBox: Box,
): FlowItem[] {
  // Lines wrap once, to the narrower of the two page kinds, so a line fits on whichever page it lands.
  const width = Math.min(firstBox.right - firstBox.left, followingBox.right - followingBox.left);
  const textWidth = Math.min(columnsOf(firstBox).textWidth, columnsOf(followingBox).textWidth);
  return [
    {
      height: 26,
      keepWithNext: false,
      inTable: false,
      draw: (page, top, box) => drawLeft(page, document.title, box.left, top, fonts.bold, 15),
    },
    ...paragraphFlow(document.openingText, fonts.regular, width, 0),
    { height: 10, keepWithNext: true, inTable: false, draw: () => undefined },
    ...document.sections.flatMap((section) => sectionFlow(section, fonts, textWidth)),
    ...totalsFlow(document, fonts),
    ...paragraphFlow(document.closingText, fonts.regular, width, 18),
  ];
}

async function embedFonts(pdf: PDFDocument): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFontBytes();
  const options = (customName: string) => ({ subset: true, customName, features: PLAIN_GLYPHS });
  return {
    regular: await pdf.embedFont(regularBytes, options('Geist-Regular')),
    bold: await pdf.embedFont(boldBytes, options('Geist-SemiBold')),
  };
}

/** Renders a business document to PDF bytes. */
export async function renderBusinessDocument(document: BusinessDocument): Promise<Uint8Array> {
  const date = new Date(`${document.issuedOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('document_date_invalid');
  const { firstBox, followingBox, addressShift } = pageGeometry(document);
  const boxOf = (pageIndex: number) => (pageIndex === 0 ? firstBox : followingBox);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const fonts = await embedFonts(pdf);
  const { stationery } = document;
  const firstUnderlay = stationery ? await embedStationery(pdf, stationery.firstPage.file) : null;
  const followingUnderlay = stationery?.followingPages
    ? await embedStationery(pdf, stationery.followingPages.file)
    : null;
  const logo = !stationery && document.sender.logo ? await embedImage(pdf, document.sender.logo) : null;

  const pages = paginate(documentFlow(document, fonts, firstBox, followingBox), boxOf);
  pages.forEach((placed, pageIndex) => {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const box = boxOf(pageIndex);
    const underlay = pageIndex === 0 ? firstUnderlay : followingUnderlay;
    if (underlay) drawUnderlay(page, underlay);
    if (pageIndex === 0) {
      if (!stationery) drawLetterhead(page, document, fonts, logo, box);
      drawAddressAndInfo(page, document, fonts, box, addressShift);
    }
    if (placed.header !== null) drawTableHeader(page, placed.header, box, fonts);
    for (const { item, top } of placed.items) item.draw(page, top, box);
    if (!stationery && document.footerColumns.length) drawFooter(page, document.footerColumns, fonts, box);
    const pageNumber = `Seite ${pageIndex + 1} von ${pages.length}`;
    drawRight(page, pageNumber, box.right, box.bottom + PAGE_NUMBER_SPACE - 9, fonts.regular, 8);
  });

  pdf.setTitle(document.title);
  pdf.setAuthor(document.sender.name);
  pdf.setLanguage('de-DE');
  pdf.setProducer('WerkFlow');
  pdf.setCreator('WerkFlow');
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  return pdf.save();
}
