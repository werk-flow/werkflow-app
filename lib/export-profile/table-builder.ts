import { ColumnAccumulator, classifyValue, type ColumnType } from './column-statistics';
import type { Cell } from './excel-workbook';
import { findPersonalDataLike } from './personal-data';
import type { XmlRecord } from './xml-records';

// Turns rows or named records into column accumulators. A row table decides
// whether its first row names the columns: it does only when every filled
// cell reads as a short label, not as a number, date, contact detail, name or
// a value the column holds again, and when a word (not a placeholder such as
// "-" or "k.A.") heads every column of numbers, dates or contact details. An
// all-text first row can be a data row (free-text notes), so it never becomes
// column names. Otherwise the columns are column_1, column_2.

export type HeaderMode = 'first row' | 'none detected' | 'positional' | 'named fields';

export type BuiltTable = {
  rows: number;
  raggedRows: number;
  header: HeaderMode;
  columns: ColumnAccumulator[];
};

type RowTableOptions = { salt: Uint8Array; detectHeader: boolean; namePrefix?: string };

/** Accumulates rows; the first row becomes the header when it reads as one. */
export function buildRowTable(rows: Iterable<readonly Cell[]>, options: RowTableOptions): BuiltTable {
  const prefix = options.namePrefix ?? 'column_';
  const columns: ColumnAccumulator[] = [];
  const column = (index: number): ColumnAccumulator => {
    let found = columns[index];
    while (!found) {
      columns.push(new ColumnAccumulator(`${prefix}${columns.length + 1}`, options.salt));
      found = columns[index];
    }
    return found;
  };
  let first: readonly Cell[] | null = null;
  let bodyRows = 0;
  let raggedRows = 0;
  for (const row of rows) {
    if (first === null && options.detectHeader) {
      first = row;
      continue;
    }
    bodyRows += 1;
    if (first !== null && row.length !== first.length) raggedRows += 1;
    row.forEach((cell, index) => column(index).add(cell.text, cell.known));
  }
  if (first === null)
    return {
      rows: bodyRows,
      raggedRows,
      header: options.detectHeader ? 'none detected' : 'positional',
      columns,
    };
  first.forEach((_, index) => column(index));
  if (looksLikeHeader(first, columns, bodyRows)) {
    nameColumns(columns, first);
    return { rows: bodyRows, raggedRows, header: 'first row', columns };
  }
  first.forEach((cell, index) => column(index).add(cell.text, cell.known));
  return { rows: bodyRows + 1, raggedRows, header: 'none detected', columns };
}

const HEADER_LABEL_LIMIT = 40;
const TYPED_COLUMNS: ReadonlySet<ColumnType> = new Set([
  'integer',
  'digit_code',
  'decimal',
  'date',
  'datetime',
  'time',
  'boolean',
  'email',
  'phone',
  'iban',
]);

function looksLikeHeader(
  first: readonly Cell[],
  columns: readonly ColumnAccumulator[],
  bodyRows: number,
): boolean {
  const filled = first.filter((cell) => cell.text.trim() !== '');
  if (bodyRows === 0 || filled.length === 0 || filled.length < first.length / 2) return false;
  const labels = first.every((cell, index) => {
    const label = cell.text.trim();
    if (label === '') return true;
    if (label.length > HEADER_LABEL_LIMIT || cell.known || classifyValue(label).kind !== 'text') return false;
    if (findPersonalDataLike(label).length > 0) return false;
    return !(columns[index]?.has(label) ?? false);
  });
  if (!labels) return false;
  // The evidence: every column of numbers, dates or contact details is
  // headed by a word. A data row would hold a value or a placeholder there.
  const typed = columns.flatMap((column, index) =>
    TYPED_COLUMNS.has(column.profile(bodyRows).type) ? [first[index]?.text.trim() ?? ''] : [],
  );
  return typed.length > 0 && typed.every(isWordLabel);
}

const PLACEHOLDERS = new Set(['k.a.', 'n/a', 'null', 'none', 'keine', 'kein', 'leer', 'unbekannt', 'offen']);

function isWordLabel(label: string): boolean {
  return (label.match(/\p{L}/gu)?.length ?? 0) >= 2 && !PLACEHOLDERS.has(label.toLowerCase());
}

function nameColumns(columns: readonly ColumnAccumulator[], header: readonly Cell[]): void {
  const used = new Map<string, number>();
  columns.forEach((column, index) => {
    const label = header[index]?.text.trim() ?? '';
    if (label === '') return;
    const seen = (used.get(label) ?? 0) + 1;
    used.set(label, seen);
    column.name = seen === 1 ? label : `${label} #${seen}`;
  });
}

/** Accumulates records whose fields carry their own names (XML), one table per record path. */
export function buildNamedTables(records: Iterable<XmlRecord>, salt: Uint8Array): Map<string, BuiltTable> {
  const tables = new Map<string, { rows: number; columns: Map<string, ColumnAccumulator> }>();
  for (const record of records) {
    let table = tables.get(record.path);
    if (!table) {
      table = { rows: 0, columns: new Map() };
      tables.set(record.path, table);
    }
    table.rows += 1;
    for (const [name, value] of record.fields) {
      let column = table.columns.get(name);
      if (!column) {
        column = new ColumnAccumulator(name, salt);
        table.columns.set(name, column);
      }
      column.add(value);
    }
  }
  return new Map(
    [...tables].map(([path, table]) => [
      path,
      { rows: table.rows, raggedRows: 0, header: 'named fields', columns: [...table.columns.values()] },
    ]),
  );
}
