// Sections a closed plan record must carry. A slice record closes with its deletion pass and
// review (docs/technical/code-quality.md, "Deletion pass and independent review"), and every
// closed plan record names the living docs that now hold its lasting facts (docs/README.md,
// maintenance rules), because nobody reopens a closed record unprompted. Records closed before
// a rule took effect are history.

/** The first closing day each rule applies to. */
export const DELETION_PASS_SINCE = '2026-09-15';
export const DURABLE_HOMES_SINCE = '2026-09-17';

function sectionBody(markdown: string, heading: string): string | null {
  const pattern = new RegExp(`^## ${heading}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'im');
  return markdown.match(pattern)?.[1] ?? null;
}

/**
 * The problems of a closed slice record's "Deletion pass and review" section: missing, without
 * the two `git diff --shortstat` lines before and after the pass, or without the review command.
 */
export function deletionPassProblems(markdown: string): string[] {
  const section = sectionBody(markdown, 'Deletion pass and review');
  if (section === null)
    return [
      'closes without a "## Deletion pass and review" section (docs/technical/code-quality.md, Deletion pass and independent review)',
    ];
  const problems: string[] = [];
  if ((section.match(/\d+ files? changed/g) ?? []).length < 2)
    problems.push('must record the git diff --shortstat line before and after the deletion pass');
  if (!/bun run review\b/.test(section))
    problems.push('must record the bun run review command it ran and the disposition of every finding');
  return problems;
}

/** Whether a closed plan record names the living homes of its lasting facts. */
export function hasDurableHomes(markdown: string): boolean {
  return (sectionBody(markdown, 'Durable homes')?.trim() ?? '') !== '';
}
