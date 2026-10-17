// A decision record is immutable once accepted; it changes only by a dated amendment section
// appended at its end (docs/README.md, maintenance rules). A record rewritten in place loses
// the reason a later reader needs, so the check compares it with its committed and published text.

const AMENDMENT_HEADING = /^## Amendment \d{4}-\d{2}-\d{2}: \S/;

function normalized(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').trimEnd();
}

/**
 * The problem with a decision record's current text against an earlier accepted text, or null:
 * the earlier text must stay a prefix, and everything after it must be sections whose `##`
 * headings read `## Amendment YYYY-MM-DD: <title>`.
 */
export function decisionGrowthProblem(earlier: string, current: string): string | null {
  const before = normalized(earlier);
  const now = normalized(current);
  if (now === before) return null;
  // The accepted text ends at a line break, so nothing may extend its last line.
  if (!now.startsWith(`${before}\n`)) {
    const beforeLines = before.split('\n');
    const nowLines = now.split('\n');
    const index = beforeLines.findIndex((line, position) => nowLines[position] !== line);
    const line = index === -1 ? beforeLines.length : index + 1;
    return `line ${line} of the accepted text changed; restore it and record the change as a dated amendment section at the end`;
  }
  const added = now.slice(before.length).replace(/^\n+/, '');
  const headings = added.split('\n').filter((line) => /^#{1,2} /.test(line));
  if (!added.startsWith('## ') || headings.some((heading) => !AMENDMENT_HEADING.test(heading)))
    return 'the added text must be sections headed "## Amendment YYYY-MM-DD: <title>"';
  return null;
}
