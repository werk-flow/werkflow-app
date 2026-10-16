/**
 * The deletion pass in commit bodies (docs/technical/code-quality.md,
 * "Deletion pass and independent review"): every commit a push publishes
 * carries a `Deletion pass:` line with what the pass removed, or, for a slice
 * commit, where the slice record holds it. The pre-push gate
 * (scripts/check-publication-gate.ts) reads the bodies of the commits that no
 * remote has yet and refuses the push while one lacks the line.
 */
export type PublishedCommit = { sha: string; message: string };

const DELETION_PASS_LINE = /^Deletion pass:(.*)$/m;

/**
 * The recorded deletion pass in the body of a commit message (the subject
 * line does not count), or undefined when the line is missing or empty.
 */
export function deletionPassRecord(message: string): string | undefined {
  const body = message.split('\n').slice(1).join('\n');
  const value = DELETION_PASS_LINE.exec(body)?.[1]?.trim();
  return value ? value : undefined;
}

export function deletionPassProblems(commits: readonly PublishedCommit[]): string[] {
  return commits.flatMap(({ sha, message }) => {
    if (deletionPassRecord(message) !== undefined) return [];
    const subject = message.split('\n', 1)[0] ?? '';
    return [
      `Commit ${sha.slice(0, 7)} ("${subject}") records no deletion pass: add a "Deletion pass: <what it removed>" line to its body (docs/technical/code-quality.md).`,
    ];
  });
}

/** Splits `git log --format=%H%x00%B%x1e` output into commits. */
export function parsePublishedCommits(log: string): PublishedCommit[] {
  return log.split('\x1e').flatMap((record) => {
    const [sha, message] = record.replace(/^\s+/, '').split('\0');
    return sha && message !== undefined ? [{ sha, message }] : [];
  });
}
