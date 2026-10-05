/** The environment variable that asks a focused iteration run to rewrite changed visual references. */
export const VISUAL_REFERENCE_UPDATE_ENV = 'WERKFLOW_UPDATE_VISUAL_REFERENCES';

/**
 * Playwright's `updateSnapshots` for the audit suite. Only an explicit focused
 * iteration rewrites a reference, and only one whose difference exceeds its
 * tolerance; every other run, a verification group above all, compares and
 * fails on a missing reference instead of writing it.
 */
export function visualReferenceUpdateMode(
  environment: Readonly<Record<string, string | undefined>>,
): 'changed' | 'none' {
  return environment.WERKFLOW_TEST_LANE === 'iteration' && environment[VISUAL_REFERENCE_UPDATE_ENV] === '1'
    ? 'changed'
    : 'none';
}

const UPDATE_COMMAND_PREFIX = `${VISUAL_REFERENCE_UPDATE_ENV}=1 `;

/** The command an update run records in its manifest; the prefix is what marks the run as an update. */
export function visualReferenceUpdateCommand(command: string): string {
  return `${UPDATE_COMMAND_PREFIX}${command}`;
}

/**
 * An update run writes the references it compares, so it certifies nothing and
 * is no attempt of the repeat rule: neither a failure nor a pass of the focused
 * iteration it resembles. Only the iteration lane can be one; a verification
 * group never writes a reference and always counts.
 */
export function isVisualReferenceUpdateRun(run: { lane: string; command: string }): boolean {
  return run.lane === 'iteration' && run.command.startsWith(UPDATE_COMMAND_PREFIX);
}
