// A living doc's status line carries the date of its last review ("last reviewed YYYY-MM-DD").
// Every change to a living doc is a review of it, so the stamp moves with each change; a stamp
// older than the doc's last change says nothing (docs/README.md, maintenance rules).

/**
 * A doc's last change: today when the working tree changes it, else its last commit, with
 * whether that commit also moved the stamp (then it recorded its own review, whatever its date).
 */
export type LastChange = { date: string; uncommitted: boolean; movedStamp: boolean };

/**
 * The problem with a living doc's review stamp, or null: the stamp names a day after today, or
 * it predates a change that did not move it.
 */
export function reviewStampProblem(stamp: string, change: LastChange, today: string): string | null {
  if (stamp > today) return `its status line names ${stamp}, a day after today (${today})`;
  if (stamp >= change.date || (!change.uncommitted && change.movedStamp)) return null;
  return change.uncommitted
    ? `it changed in the working tree today (${change.date}), but its status line still says last reviewed ${stamp}; set the date to ${change.date}`
    : `its last commit is from ${change.date}, after its status line's last reviewed ${stamp}; review it and set the date`;
}

/** One commit as `git log --name-only --format=%x00%H %as` prints it. */
export type CommitRef = { hash: string; date: string };

/**
 * The newest commit of each path from `git log --name-only --format=%x00%H %as` output, newest
 * commit first: the first commit that lists a path is its last change.
 */
export function lastCommits(gitLog: string): Map<string, CommitRef> {
  const commits = new Map<string, CommitRef>();
  for (const chunk of gitLog.split('\u0000').filter((part) => part.trim() !== '')) {
    const [header = '', ...paths] = chunk.split('\n').map((line) => line.trim());
    const [hash = '', date = ''] = header.split(' ');
    for (const path of paths) {
      if (path !== '' && !commits.has(path)) commits.set(path, { hash, date });
    }
  }
  return commits;
}

/** The paths `git status --porcelain=v1 -z` reports as changed or untracked, renames by their new path. */
export function uncommittedPaths(porcelain: string): Set<string> {
  const paths = new Set<string>();
  const entries = porcelain.split('\u0000');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    // A rename or copy is followed by its old path, which is not a change of its own.
    if (entry.startsWith('R') || entry.startsWith('C')) index += 1;
  }
  return paths;
}
