import { readDatanormDelivery } from '../inventory/datanorm/read-delivery';
import { datanormLines, datanormRecordType } from '../inventory/datanorm/records';
import { buildRowTable, type BuiltTable } from './table-builder';

// DATANORM article files. Versions 4 and 5 separate fields with semicolons
// and start each line with its record type (A, B, P, V, ...); each record
// type becomes one table with positional fields. Version 3 is fixed-width:
// its lines are counted per record type, and reading its fields needs the
// DATANORM 3 field layout. A record type is one letter; any other first
// field is data, so those lines share the table "(other)" and never name one.

export type DatanormTable = { recordType: string; fixedWidth: boolean; table: BuiltTable };

/** One table per DATANORM record type. */
export function datanormTables(text: string, salt: Uint8Array): DatanormTable[] {
  const lines = datanormLines(text).map((line) => line.text);
  const fixedWidth = lines.filter((line) => line.includes(';')).length < lines.length / 2;
  const byType = new Map<string, string[][]>();
  for (const line of lines) {
    const fields = fixedWidth ? [line.slice(0, 1)] : line.split(';');
    const recordType = datanormRecordType(fields[0] ?? '');
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

/**
 * What the DATANORM 4 reader of the catalog import refuses in this file, read on
 * its own, as rejection codes with counts and never a value. Null when it
 * refuses nothing.
 */
export function datanormReaderNote(name: string, bytes: Uint8Array): string | null {
  const counts = new Map<string, number>();
  for (const { code } of readDatanormDelivery([{ name, bytes }]).rejected)
    counts.set(code, (counts.get(code) ?? 0) + 1);
  if (counts.size === 0) return null;
  const listed = [...counts].map(([code, count]) => `${code} ${count}`).join(', ');
  return `the DATANORM 4 reader, reading this file alone, refuses: ${listed}`;
}
