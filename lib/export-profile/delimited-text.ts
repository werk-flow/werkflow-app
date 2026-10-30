import { ExportFormatError } from './zip-archive';

// Delimited text (CSV, TSV, semicolon exports): the delimiter and the rows.

const CANDIDATE_DELIMITERS = [';', '\t', ',', '|'] as const;

export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/**
 * The delimiter the first records use most consistently, or null when the
 * text is not delimited. Records are read with the parser's own quote rules,
 * so a quoted line break or a literal quote counts the same in both.
 */
export function detectDelimiter(text: string): Delimiter | null {
  const declared = /^sep=(.)\r?\n/i.exec(text)?.[1];
  const declaredDelimiter = CANDIDATE_DELIMITERS.find((candidate) => candidate === declared);
  if (declaredDelimiter) return declaredDelimiter;
  let best: { delimiter: Delimiter; score: number } | null = null;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = firstRecordWidths(text, delimiter);
    if (counts === null) continue;
    if (counts.length === 0) return null;
    const modal = mostCommon(counts);
    if (modal === 0) continue;
    const consistent = counts.filter((count) => count === modal).length / counts.length;
    if (consistent < 0.8) continue;
    const score = consistent * 100 + modal;
    if (!best || score > best.score) best = { delimiter, score };
  }
  return best?.delimiter ?? null;
}

/** The number of delimiters in each of the first records, or null when a quote opened under this delimiter never closes. */
function firstRecordWidths(text: string, delimiter: Delimiter): number[] | null {
  const widths: number[] = [];
  try {
    for (const row of delimitedRows(text, delimiter)) {
      widths.push(row.length - 1);
      if (widths.length === 30) break;
    }
  } catch (error) {
    if (error instanceof ExportFormatError) return null;
    throw error;
  }
  return widths;
}

function mostCommon(values: readonly number[]): number {
  const tally = new Map<number, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount) [best, bestCount] = [value, count];
  }
  return best;
}

/** The rows of delimited text, with RFC 4180 quoting. Blank lines are skipped. */
export function* delimitedRows(text: string, delimiter: Delimiter): Generator<string[]> {
  const body = text.replace(/^sep=.\r?\n/i, '');
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (character !== '"') field += character;
      else if (body[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
      continue;
    }
    if (character === '"' && field === '') quoted = true;
    else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && body[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell !== '')) yield row;
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new ExportFormatError('delimited_quote_unclosed');
  row.push(field);
  if (row.some((cell) => cell !== '')) yield row;
}
