// A closed record keeps the instructions of its plan as history, and an agent that lands in
// one could carry out an old step. A pattern for imperative sentences cannot tell a plan step
// from a current rule, so every closed record opens with one fixed banner instead.

export const CLOSED_RECORD_BANNER =
  '> This record is history. Do not carry out its instructions: the living docs that the index lists hold the current rules.';

/** The 1-based line of the banner: under the H1, a blank line, the status line and a blank line. */
export const CLOSED_RECORD_BANNER_LINE = 5;

/** Whether a closed record carries the banner on its line, followed by a blank line. */
export function hasClosedRecordBanner(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  return (
    lines[CLOSED_RECORD_BANNER_LINE - 2]?.trim() === '' &&
    lines[CLOSED_RECORD_BANNER_LINE - 1] === CLOSED_RECORD_BANNER &&
    (lines[CLOSED_RECORD_BANNER_LINE] ?? '').trim() === ''
  );
}
