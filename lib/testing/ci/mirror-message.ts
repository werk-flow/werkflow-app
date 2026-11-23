// The commit message of a CI mirror push (scripts/ci/mirror-executor.ts): which job or shard of
// which run the mirror runs, on which source commit and tree, under which Plan. The orchestrator
// writes it; scripts/ci/mirror-job.ts reads it on the mirror before any install, so this module
// imports nothing outside lib/testing/ci/dag.ts.
import { CI_JOBS, type CiJob } from './dag';

/** The message's first line; the run follows as one JSON line after a blank line. */
const SUBJECT = 'CI mirror run';

/**
 * The run's variables a mirror job takes as they are (scripts/ci/job.ts names them). Nothing else
 * of the run reaches the public mirror: no token, path of the orchestrator's host, repository name
 * or pull request ref.
 */
const MIRROR_VARIABLES = [
  'CI_EVENT',
  'CI_RUN_URL',
  'CI_RUN_ATTEMPT',
  'CI_PRODUCER',
  'CI_PRS',
  'CI_FIRST_ATTEMPT_CLASS',
  'SHRINK_ONLY_GROWTH_APPROVED',
] as const;

export type MirrorRun = {
  version: 1;
  job: CiJob;
  shard: number | null;
  /** The commit the run tests and its tree; the mirror's commit holds that tree transformed. */
  source: { commit: string; tree: string };
  variables: Partial<Record<(typeof MIRROR_VARIABLES)[number], string>>;
  /** The run's Plan result, which every job after Plan reads as plan.json. */
  plan: Record<string, unknown>;
};

/** The variables of MIRROR_VARIABLES from a job's environment; a value with a line break throws. */
export function mirrorVariables(env: Readonly<Record<string, string | undefined>>): MirrorRun['variables'] {
  const variables: MirrorRun['variables'] = {};
  for (const name of MIRROR_VARIABLES) {
    const value = env[name];
    if (!value) continue;
    if (/[\r\n]/.test(value)) throw new Error(`${name} holds a line break.`);
    variables[name] = value;
  }
  return variables;
}

export function mirrorMessage(run: MirrorRun): string {
  return `${SUBJECT}\n\n${JSON.stringify(run)}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const OBJECT_ID = /^[0-9a-f]{40}$/;

/** The run a mirror commit's message names, or why it names none. */
export function parseMirrorMessage(text: string): MirrorRun | { problem: string } {
  const [subject, blank, body, ...rest] = text.trimEnd().split('\n');
  if (subject !== SUBJECT || blank !== '' || body === undefined || rest.length)
    return { problem: 'the commit message is no CI mirror run' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { problem: 'the run is no JSON' };
  }
  if (!isRecord(parsed) || parsed.version !== 1) return { problem: 'the run is of no known version' };
  const { job, shard, source, variables, plan } = parsed;
  const known = CI_JOBS.find((name) => name === job);
  if (!known) return { problem: 'the run names no job' };
  if (!(shard === null || (typeof shard === 'number' && Number.isInteger(shard) && shard > 0)))
    return { problem: 'the run names no shard' };
  if (
    !isRecord(source) ||
    typeof source.commit !== 'string' ||
    typeof source.tree !== 'string' ||
    !OBJECT_ID.test(source.commit) ||
    !OBJECT_ID.test(source.tree)
  )
    return { problem: 'the run names no source commit and tree' };
  if (!isRecord(variables)) return { problem: 'the run holds no variables' };
  const taken: MirrorRun['variables'] = {};
  for (const [name, value] of Object.entries(variables)) {
    const variable = MIRROR_VARIABLES.find((candidate) => candidate === name);
    if (!variable || typeof value !== 'string' || /[\r\n]/.test(value))
      return { problem: `the run holds the variable ${name}, which a mirror job does not take` };
    taken[variable] = value;
  }
  if (!isRecord(plan)) return { problem: 'the run holds no plan' };
  return {
    version: 1,
    job: known,
    shard,
    source: { commit: source.commit, tree: source.tree },
    variables: taken,
    plan,
  };
}
