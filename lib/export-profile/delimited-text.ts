// Delimited text (CSV, TSV, semicolon exports): the delimiter and the rows.

const CANDIDATE_DELIMITERS = [';', '\t', ',', '|'] as const;

export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/** The delimiter the first lines use most consistently, or null when the text is not delimited. */
export function detectDelimiter(text: string): Delimiter | null {
  const declared = /^sep=(.)\r?\n/i.exec(text)?.[1];
  const declaredDelimiter = CANDIDATE_DELIMITERS.find((candidate) => candidate === declared);
  if (declaredDelimiter) return declaredDelimiter;
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== '')
    .slice(0, 30);
  if (lines.length === 0) return null;
  let best: { delimiter: Delimiter; score: number } | null = null;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const modal = mostCommon(counts);
    if (modal === 0) continue;
    const consistent = counts.filter((count) => count === modal).length / counts.length;
    if (consistent < 0.8) continue;
    const score = consistent * 100 + modal;
    if (!best || score > best.score) best = { delimiter, score };
  }
  return best?.delimiter ?? null;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) count += 1;
  }
  return count;
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
  row.push(field);
  if (row.some((cell) => cell !== '')) yield row;
}
