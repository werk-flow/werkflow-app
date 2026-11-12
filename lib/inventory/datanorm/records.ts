// The line and record-type rules of a DATANORM file, shared by the
// delivery reader in this folder and the export profiler
// (lib/export-profile/datanorm.ts). A line ends with CR LF, LF or CR; a
// blank line carries no record. Each record line starts with its record
// type, one letter; any other first field is data, not a record type.

export type DatanormLine = { lineNumber: number; text: string };

/** The non-blank lines of a DATANORM file with their 1-based line numbers. */
export function datanormLines(text: string): DatanormLine[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ lineNumber: index + 1, text: line }))
    .filter((line) => line.text.trim() !== '');
}

/** The record type a line's first field names, or "(other)" when it names none. */
export function datanormRecordType(firstField: string): string {
  const trimmed = firstField.trim();
  return /^[A-Za-z]$/.test(trimmed) ? trimmed.toUpperCase() : '(other)';
}
