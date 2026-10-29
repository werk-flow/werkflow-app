import { buildRowTable, type BuiltTable } from './table-builder';

// DATANORM article files. Versions 4 and 5 separate fields with semicolons
// and start each line with its record type (A, B, P, V, ...); each record
// type becomes one table with positional fields. Version 3 is fixed-width:
// its lines are counted per record type, and reading its fields needs the
// DATANORM 3 field layout.

export type DatanormTable = { recordType: string; fixedWidth: boolean; table: BuiltTable };

/** One table per DATANORM record type. */
export function datanormTables(text: string, salt: Uint8Array): DatanormTable[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '');
  const fixedWidth = lines.filter((line) => line.includes(';')).length < lines.length / 2;
  const byType = new Map<string, string[][]>();
  for (const line of lines) {
    const fields = fixedWidth ? [line.slice(0, 1)] : line.split(';');
    const recordType = (fields[0] ?? '').trim() || '?';
    const rows = byType.get(recordType) ?? [];
    rows.push(fields);
    byType.set(recordType, rows);
  }
  return [...byType].map(([recordType, rows]) => ({
    recordType,
    fixedWidth,
    table: fixedWidth
      ? { rows: rows.length, raggedRows: 0, header: 'positional', columns: [] }
      : buildRowTable(
          rows.map((fields) => fields.map((field) => ({ text: field }))),
          { salt, detectHeader: false, namePrefix: 'field_' },
        ),
  }));
}
