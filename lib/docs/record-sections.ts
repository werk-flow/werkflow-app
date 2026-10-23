// Sections a closed plan record must carry. A slice record closes with its deletion pass and
// review (docs/technical/code-quality.md, "Deletion pass and independent review"), and every
// closed plan record names the living docs that now hold its lasting facts (docs/README.md,
// maintenance rules), because nobody reopens a closed record unprompted. Records closed before
// a rule took effect are history.

/** The first closing day each rule applies to. */
export const DELETION_PASS_SINCE = '2026-09-15';
export const DURABLE_HOMES_SINCE = '2026-09-17';
export const REVIEW_RECORDS_SINCE = '2026-10-24';

const SHORTSTAT = /\d+ files? changed/g;
const REVIEW_RECORD_PATH = /\.agent-logs\/review\/[a-f0-9]{40}(?:-\d{8}T\d{9}Z)?\.json/g;

function sectionBody(markdown: string, heading: string): string | null {
  const pattern = new RegExp(`^## ${heading}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'im');
  return markdown.match(pattern)?.[1] ?? null;
}

/**
 * The problems of a closed slice record's "Deletion pass and review" section: missing; without
 * the `git diff --shortstat` lines labelled before and after the pass; without what the pass
 * removed ("Removed:" or "Deleted:" with the items) or "nothing to remove" with its reason; without
 * the review command; and, from REVIEW_RECORDS_SINCE, without a cited review record
 * (`.agent-logs/review/<sha>-<time>.json`). `recordedReview` checks a cited record against the
 * evidence ledger; the caller passes null where the evidence cannot be on this machine. Whether
 * the pass and the dispositions are right stays the reviewer's reading.
 */
export function deletionPassProblems(input: {
  markdown: string;
  closedOn: string;
  recordedReview: ((path: string) => boolean) | null;
}): string[] {
  const section = sectionBody(input.markdown, 'Deletion pass and review');
  if (section === null)
    return [
      'closes without a "## Deletion pass and review" section (docs/technical/code-quality.md, Deletion pass and independent review)',
    ];
  const problems: string[] = [];
  if (
    (section.match(SHORTSTAT) ?? []).length < 2 ||
    !/\bbefore\b[^\n]*?\d+ files? changed/i.test(section) ||
    !/\bafter\b[^\n]*?\d+ files? changed/i.test(section)
  )
    problems.push('must record the git diff --shortstat line before and after the deletion pass');
  if (
    !/\b(?:removed|deleted):[ \t]*\S/i.test(section) &&
    !/\bnothing to remove\b[ \t]*(?:because\b|since\b|:|—|–|\()[ \t]*\S/i.test(section)
  )
    problems.push(
      'must name what the deletion pass removed ("Removed: …") or state "Nothing to remove because …"',
    );
  if (!/bun run review\b/.test(section))
    problems.push('must record the bun run review command it ran and the disposition of every finding');
  if (input.closedOn < REVIEW_RECORDS_SINCE) return problems;
  const cited = [...new Set(section.match(REVIEW_RECORD_PATH) ?? [])];
  if (!cited.length)
    problems.push('must cite the review record each review wrote (.agent-logs/review/<sha>-<time>.json)');
  const { recordedReview } = input;
  const unrecorded = recordedReview ? cited.filter((path) => !recordedReview(path)) : [];
  if (unrecorded.length)
    problems.push(`cites review records the evidence ledger does not hold: ${unrecorded.join(', ')}`);
  return problems;
}

/** Whether a closed plan record names the living homes of its lasting facts. */
export function hasDurableHomes(markdown: string): boolean {
  return (sectionBody(markdown, 'Durable homes')?.trim() ?? '') !== '';
}
