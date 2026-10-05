import type { GroupResult } from '../evidence/group-evidence';
import { PREPARED_PLAN_ENV } from './prepared-plan';

type VerificationReportState = {
  status: 'running' | 'passed' | 'failed';
  completedAt: string | null;
  results: GroupResult[];
};

/** Own the report from first publication through setup, execution and terminal accounting. */
export async function withVerificationReport(input: {
  report: VerificationReportState;
  groups: readonly Pick<GroupResult, 'groupId' | 'fingerprint' | 'logPath'>[];
  publish: () => void;
  run: (signal: AbortSignal) => Promise<void>;
  summarize: () => void;
}): Promise<void> {
  const { report } = input;
  const controller = new AbortController();
  const stop = (): void =>
    controller.abort(new Error('Verification interrupted; unfinished groups remain unproven.'));
  const previousPreparedPlan = process.env[PREPARED_PLAN_ENV];
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let unfinishedReason = 'Verification ended before this group produced a result.';
  let verificationFailed = false;
  try {
    input.publish();
    await input.run(controller.signal);
    controller.signal.throwIfAborted();
  } catch (error) {
    verificationFailed = true;
    report.status = 'failed';
    unfinishedReason = `Verification stopped before a group result: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (previousPreparedPlan === undefined) delete process.env[PREPARED_PLAN_ENV];
    else process.env[PREPARED_PLAN_ENV] = previousPreparedPlan;
    report.completedAt = new Date().toISOString();
    const finished = new Set(report.results.map((result) => result.groupId));
    for (const group of input.groups) {
      if (finished.has(group.groupId)) continue;
      report.results.push({
        ...group,
        status: 'blocked',
        startedAt: report.completedAt,
        completedAt: report.completedAt,
        durationMs: 0,
        runKey: null,
        buildId: null,
        reason: unfinishedReason,
      });
    }
    if (report.status === 'running' || report.results.some((result) => result.status !== 'passed'))
      report.status = 'failed';
    finalize([input.publish, input.summarize], verificationFailed);
  }
}

/**
 * Attempts every finalization step. A step failure surfaces only when the
 * verification itself succeeded; otherwise it is reported as secondary so the
 * original verification error stays the one the caller receives.
 */
function finalize(steps: readonly (() => void)[], verificationFailed: boolean): void {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      failures.push(error);
    }
  }
  const [first, ...rest] = failures;
  if (!failures.length) return;
  for (const failure of verificationFailed ? failures : rest)
    console.error(
      `[verify] Report finalization also failed: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  if (!verificationFailed) throw first;
}
