import { posix } from 'node:path';
import type { ClassifiedValue } from './column-statistics';
import { decodeXmlEntities, parseXmlAttributes } from './xml-text';
import { ExportFormatError, openZip, type ZipArchive } from './zip-archive';

// Excel workbooks (.xlsx, .xlsm): sheet names and cell rows. A numeric cell
// with a date format becomes a date whose year is known; its serial number
// is never kept as text.

export type Cell = { text: string; known?: ClassifiedValue };

export type WorkbookSheet = { name: string; rows: () => Generator<Cell[]> };

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 22]);
const BUILT_IN_TIME_FORMATS = new Set([18, 19, 20, 21, 45, 46, 47]);

type TemporalFormat = 'date' | 'time';
const PREFIXED = '(?:[A-Za-z_][\\w.-]*:)?';

/** The sheets of an Excel workbook, in workbook order. */
export function readWorkbook(bytes: Uint8Array): WorkbookSheet[] {
  const zip = openZip(bytes);
  const workbook = readXml(zip, 'xl/workbook.xml');
  if (workbook === null) throw new ExportFormatError('xlsx_workbook_missing');
  const targets = relationshipTargets(readXml(zip, 'xl/_rels/workbook.xml.rels') ?? '');
  const sharedStrings = readSharedStrings(readXml(zip, 'xl/sharedStrings.xml') ?? '');
  const dateStyles = readDateStyles(readXml(zip, 'xl/styles.xml') ?? '');
  const epoch = /date1904\s*=\s*"(?:1|true)"/.test(workbook) ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const sheets: WorkbookSheet[] = [];
  for (const match of workbook.matchAll(new RegExp(`<${PREFIXED}sheet\\b([^>]*?)/?>`, 'g'))) {
    const attributes = parseXmlAttributes(match[1] ?? '');
    const relationId = [...attributes].find(([key]) => key.endsWith(':id'))?.[1];
    const target = relationId === undefined ? undefined : targets.get(relationId);
    // A declared sheet without its part would pass as an empty table.
    const sheetXml = target === undefined ? null : readXml(zip, target);
    if (sheetXml === null) throw new ExportFormatError('xlsx_sheet_missing');
    const name = attributes.get('name') ?? '';
    sheets.push({ name, rows: () => sheetRows(sheetXml, { sharedStrings, dateStyles, epoch }) });
  }
  return sheets;
}

function readXml(zip: ZipArchive, name: string): string | null {
  const bytes = zip.read(name);
  return bytes === null ? null : new TextDecoder('utf-8').decode(bytes);
}

function relationshipTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attributes = parseXmlAttributes(match[1] ?? '');
    const id = attributes.get('Id');
    const target = attributes.get('Target');
    if (id === undefined || target === undefined) continue;
    // A target is relative to xl/workbook.xml (./worksheets/sheet1.xml, ../xl/...) or absolute from the package root.
    targets.set(id, target.startsWith('/') ? target.slice(1) : posix.join('xl', target));
  }
  return targets;
}

function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const item of xml.matchAll(new RegExp(`<${PREFIXED}si\\b[^>]*>([\\s\\S]*?)</${PREFIXED}si>`, 'g'))) {
    strings.push(textRuns(item[1] ?? ''));
  }
  return strings;
}

function textRuns(xml: string): string {
  let text = '';
  for (const run of xml.matchAll(new RegExp(`<${PREFIXED}t\\b[^>]*>([\\s\\S]*?)</${PREFIXED}t>`, 'g')))
    text += decodeXmlEntities(run[1] ?? '');
  return text;
}

/** The style indexes whose number format shows a calendar date or a time of day or duration. */
function readDateStyles(xml: string): Map<number, TemporalFormat> {
  const customFormats = new Map<number, TemporalFormat>();
  for (const match of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const attributes = parseXmlAttributes(match[1] ?? '');
    const rawCode = attributes.get('formatCode') ?? '';
    // An elapsed-time token ([h]:mm, [mm]:ss) marks a duration; other
    // brackets ([$-407], [Red]) and quoted text carry no date part.
    const elapsed = /\[(?:h+|m+|s+)\]/i.test(rawCode);
    const code = rawCode.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    const kind = elapsed
      ? 'time'
      : /[dy]/i.test(code)
        ? 'date'
        : /[hs]/i.test(code)
          ? 'time'
          : /m/i.test(code)
            ? 'date'
            : null;
    if (kind) customFormats.set(Number(attributes.get('numFmtId')), kind);
  }
  const cellFormats = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const styles = new Map<number, TemporalFormat>();
  let index = 0;
  for (const match of cellFormats.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const formatId = Number(parseXmlAttributes(match[1] ?? '').get('numFmtId') ?? 0);
    const kind = BUILT_IN_DATE_FORMATS.has(formatId)
      ? 'date'
      : BUILT_IN_TIME_FORMATS.has(formatId)
        ? 'time'
        : customFormats.get(formatId);
    if (kind) styles.set(index, kind);
    index += 1;
  }
  return styles;
}

type SheetContext = {
  sharedStrings: readonly string[];
  dateStyles: ReadonlyMap<number, TemporalFormat>;
  epoch: number;
};

function* sheetRows(xml: string, context: SheetContext): Generator<Cell[]> {
  const rowPattern = new RegExp(`<${PREFIXED}row\\b[^>]*?(?:/>|>([\\s\\S]*?)</${PREFIXED}row>)`, 'g');
  const cellPattern = new RegExp(`<${PREFIXED}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${PREFIXED}c>)`, 'g');
  for (const row of xml.matchAll(rowPattern)) {
    const cells: Cell[] = [];
    let nextColumn = 0;
    for (const cell of (row[1] ?? '').matchAll(cellPattern)) {
      const attributes = parseXmlAttributes(cell[1] ?? '');
      const reference = attributes.get('r');
      const column = reference === undefined ? nextColumn : columnIndex(reference);
      while (cells.length < column) cells.push({ text: '' });
      cells[column] = cellValue(attributes, cell[2] ?? '', context);
      nextColumn = column + 1;
    }
    if (cells.some((cell) => cell.text.trim() !== '')) yield cells;
  }
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function cellValue(attributes: ReadonlyMap<string, string>, inner: string, context: SheetContext): Cell {
  const type = attributes.get('t') ?? 'n';
  const raw = decodeXmlEntities(
    new RegExp(`<${PREFIXED}v\\b[^>]*>([\\s\\S]*?)</${PREFIXED}v>`).exec(inner)?.[1] ?? '',
  );
  if (type === 's') return { text: context.sharedStrings[Number(raw)] ?? '' };
  if (type === 'inlineStr') return { text: textRuns(inner) };
  if (type === 'b') return { text: raw === '1' ? 'true' : 'false' };
  if (type === 'd') return { text: raw };
  if (type !== 'n' || raw === '') return { text: raw };
  const style = Number(attributes.get('s') ?? -1);
  const format = context.dateStyles.get(style);
  if (format === undefined) return { text: raw };
  if (format === 'time') return { text: raw, known: { kind: 'time' } };
  const serial = Number(raw);
  const year = new Date(context.epoch + serial * 86_400_000).getUTCFullYear();
  // A number beyond the calendar (an id formatted as a date by mistake) stays an ordinary value.
  if (Number.isNaN(year)) return { text: raw };
  return { text: raw, known: { kind: Number.isInteger(serial) ? 'date' : 'datetime', year } };
}
