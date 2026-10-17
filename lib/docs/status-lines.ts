// Every doc under docs/ opens with its H1, one blank line and its status on line 3, in the
// shape of its genre (docs/README.md, maintenance rules): a living doc names the day of its
// last review, a closed doc its closing day, a decision record its acceptance day.

type DocStatusKind = 'living' | 'closed' | 'accepted';
export type DocStatus = { kind: DocStatusKind; date: string };

const LIVING_STATUS = /^Status: living — last reviewed (\d{4}-\d{2}-\d{2})(; .+)?$/;
const CLOSED_STATUS = /^Status: closed \((\d{4}-\d{2}-\d{2})\) — .+$/;
const DECISION_STATUS = /^- \*\*Status:\*\* accepted \((\d{4}-\d{2}-\d{2})\)( — .+)?$/;

/**
 * The status of a doc, given its path under docs/ and its text, or the problem with its first
 * three lines. Decision records use their metadata line; every other doc is living or closed.
 */
export function readDocStatus(path: string, markdown: string): { status: DocStatus } | { problem: string } {
  const lines = markdown.split(/\r?\n/);
  if (!lines[0]?.startsWith('# ')) return { problem: 'must start with an H1 on line 1' };
  if ((lines[1] ?? '').trim() !== '')
    return { problem: 'needs one blank line between the H1 and the status line' };
  const statusLine = (lines[2] ?? '').trimEnd();
  const pattern = path.startsWith('decisions/')
    ? DECISION_STATUS
    : statusLine.startsWith('Status: closed')
      ? CLOSED_STATUS
      : LIVING_STATUS;
  const date = statusLine.match(pattern)?.[1];
  if (date === undefined)
    return {
      problem: `line 3 must match ${pattern} (docs/README.md maintenance rule 1); found: "${statusLine}"`,
    };
  const kind: DocStatusKind =
    pattern === DECISION_STATUS ? 'accepted' : pattern === CLOSED_STATUS ? 'closed' : 'living';
  return { status: { kind, date } };
}
