import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { findPersonalDataLike, type PersonalDataKind } from './personal-data';

// Where the profile may go, and the last check before it is written. The
// export and its profile stay outside every Git repository, so no commit,
// worktree or agent workspace picks either of them up.

/** The path with symbolic links resolved, also when its last segments do not exist yet. */
function canonicalPath(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    existing = parent;
  }
  return join(realpathSync(existing), relative(existing, absolute));
}

/** The root of the Git repository that contains `path`, or null. */
function enclosingRepository(path: string): string | null {
  let folder = canonicalPath(path);
  for (;;) {
    if (existsSync(join(folder, '.git'))) return folder;
    const parent = dirname(folder);
    if (parent === folder) return null;
    folder = parent;
  }
}

function isSameOrInside(path: string, folder: string): boolean {
  const between = relative(folder, path);
  return between === '' || (between !== '..' && !between.startsWith(`..${sep}`) && !isAbsolute(between));
}

export type OutputDecision =
  | { ok: true; folder: string }
  | {
      ok: false;
      reason:
        | 'input_missing'
        | 'input_inside_repository'
        | 'output_inside_repository'
        | 'output_overlaps_input'
        | 'output_not_empty';
    };

type OutputRequest = { input: string; requestedOutput: string | null; home: string; today: string };

/** Checks the input folder and picks the output folder, or names why it refuses. */
export function decideOutputFolder(request: OutputRequest): OutputDecision {
  if (!existsSync(request.input) || !statSync(request.input).isDirectory())
    return { ok: false, reason: 'input_missing' };
  const input = canonicalPath(request.input);
  if (enclosingRepository(input) !== null) return { ok: false, reason: 'input_inside_repository' };
  const base = request.requestedOutput ?? join(request.home, 'werkflow-export-profiles', request.today);
  for (let attempt = 1; ; attempt += 1) {
    // Each candidate is checked after resolving links: `<date>-2` may be a
    // link into a repository even when `<date>` is not.
    const candidate = canonicalPath(attempt === 1 ? base : `${base}-${attempt}`);
    if (enclosingRepository(candidate) !== null) return { ok: false, reason: 'output_inside_repository' };
    if (isSameOrInside(candidate, input) || isSameOrInside(input, candidate))
      return { ok: false, reason: 'output_overlaps_input' };
    if (isEmptyOrMissing(candidate)) return { ok: true, folder: candidate };
    if (request.requestedOutput !== null) return { ok: false, reason: 'output_not_empty' };
  }
}

function isEmptyOrMissing(folder: string): boolean {
  return !existsSync(folder) || (statSync(folder).isDirectory() && readdirSync(folder).length === 0);
}

export type SelfCheckFinding = { file: string; line: number; kind: PersonalDataKind; section: string | null };

/**
 * Every line of the rendered output that still looks like personal data. A
 * finding names its file, line, kind and the nearest clean heading, never
 * the matched text, so the report itself is safe to show.
 */
export function selfCheckOutput(outputs: readonly { file: string; text: string }[]): SelfCheckFinding[] {
  const findings: SelfCheckFinding[] = [];
  for (const output of outputs) {
    let section: string | null = null;
    output.text.split('\n').forEach((line, index) => {
      const kinds = new Set(findPersonalDataLike(line).map((finding) => finding.kind));
      if (kinds.size === 0 && line.startsWith('#')) section = line.replace(/^#+\s*/, '');
      for (const kind of kinds) findings.push({ file: output.file, line: index + 1, kind, section });
    });
  }
  return findings;
}
