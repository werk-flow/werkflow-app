import { expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomically } from './file-lock';
import { groupResultSchema, type GroupResult } from '../evidence/group-evidence';
import { PREPARED_PLAN_ENV } from './prepared-plan';
import { summarizeCampaign } from '../evidence/campaign-summary';
import { withVerificationReport } from './verification-lifecycle';

for (const phase of ['preflight', 'discovery', 'prepared plan', 'group execution']) {
  test(`${phase} failure finalizes the published report, blocked scope, cost and process cleanup`, async () => {
    const prefix = join(tmpdir(), 'werkflow-report-');
    const directory = mkdtempSync(prefix);
    const reportPath = join(directory, 'report.json');
    const report: {
      status: 'running' | 'passed' | 'failed';
      completedAt: string | null;
      results: GroupResult[];
    } = { status: 'running', completedAt: null, results: [] };
    const groups = ['static:lint', 'golden:one'].map((groupId) => ({
      groupId,
      fingerprint: 'a'.repeat(64),
      logPath: join(directory, groupId.replace(':', '-') + '.log'),
    }));
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    const interruptListeners = process.listenerCount('SIGINT');
    const terminateListeners = process.listenerCount('SIGTERM');
    const previousPlan = process.env[PREPARED_PLAN_ENV];
    let summaries = 0;
    try {
      await expect(
        withVerificationReport({
          report,
          groups,
          publish: () => writeJsonAtomically(reportPath, report),
          run: async () => {
            expect(JSON.parse(readFileSync(reportPath, 'utf8')).status).toBe('running');
            process.env[PREPARED_PLAN_ENV] = 'prepared-by-failed-run';
            if (phase === 'group execution') {
              const group = groups[0];
              if (!group) throw new Error('Missing fixture group');
              report.results.push({
                ...group,
                status: 'passed',
                startedAt,
                completedAt: startedAt,
                durationMs: 1,
                runKey: null,
                buildId: null,
                reason: null,
              });
            }
            throw new Error(`${phase} unavailable`);
          },
          summarize: () => {
            summaries += 1;
            const summary = summarizeCampaign({
              reports: [{ ...report, id: 'failed-setup', startedAt }],
              runs: [],
              since: startedAt,
            });
            expect(summary.wallClockMinutes).toBeGreaterThanOrEqual(2);
          },
        }),
      ).rejects.toThrow(`${phase} unavailable`);
      expect(summaries).toBe(1);
      expect(report.status).toBe('failed');
      expect(report.completedAt).not.toBeNull();
      expect(report.results).toHaveLength(2);
      for (const result of report.results) {
        expect(groupResultSchema.safeParse(result).success).toBe(true);
        if (result.status === 'blocked') expect(result.reason).toContain(`${phase} unavailable`);
      }
      expect(report.results.filter((result) => result.status === 'passed')).toHaveLength(
        phase === 'group execution' ? 1 : 0,
      );
      expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(report);
      expect(process.env[PREPARED_PLAN_ENV]).toBe(previousPlan);
      expect(process.listenerCount('SIGINT')).toBe(interruptListeners);
      expect(process.listenerCount('SIGTERM')).toBe(terminateListeners);
    } finally {
      expect(directory.startsWith(prefix)).toBe(true);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('a successful run remains passed and restores an enclosing prepared plan', async () => {
  const original = process.env[PREPARED_PLAN_ENV];
  process.env[PREPARED_PLAN_ENV] = 'enclosing-plan';
  const report: {
    status: 'running' | 'passed' | 'failed';
    completedAt: string | null;
    results: GroupResult[];
  } = { status: 'running', completedAt: null, results: [] };
  const publications: string[] = [];
  try {
    await withVerificationReport({
      report,
      groups: [],
      publish: () => {
        publications.push(report.status);
      },
      run: async () => {
        process.env[PREPARED_PLAN_ENV] = 'inner-plan';
        report.status = 'passed';
      },
      summarize: () => {},
    });
    expect(publications).toEqual(['running', 'passed']);
    expect(process.env[PREPARED_PLAN_ENV]).toBe('enclosing-plan');
    expect(report.completedAt).not.toBeNull();
  } finally {
    if (original === undefined) delete process.env[PREPARED_PLAN_ENV];
    else process.env[PREPARED_PLAN_ENV] = original;
  }
});

test('interruption during setup records terminal failure and the unfinished group', async () => {
  const report: {
    status: 'running' | 'passed' | 'failed';
    completedAt: string | null;
    results: GroupResult[];
  } = { status: 'running', completedAt: null, results: [] };
  await expect(
    withVerificationReport({
      report,
      groups: [{ groupId: 'golden:one', fingerprint: 'a'.repeat(64), logPath: 'test.log' }],
      publish: () => {},
      run: async () => {
        process.emit('SIGINT');
      },
      summarize: () => {},
    }),
  ).rejects.toThrow('Verification interrupted');
  expect(report.status).toBe('failed');
  expect(report.results[0]?.reason).toContain('Verification interrupted');
});

test('a finalization failure never replaces the verification error, and every step is attempted', async () => {
  const report: {
    status: 'running' | 'passed' | 'failed';
    completedAt: string | null;
    results: GroupResult[];
  } = { status: 'running', completedAt: null, results: [] };
  const secondary = spyOn(console, 'error').mockImplementation(() => {});
  try {
    let publications = 0;
    let summaries = 0;
    await expect(
      withVerificationReport({
        report,
        groups: [],
        publish: () => {
          publications += 1;
          if (publications > 1) throw new Error('report disk full');
        },
        run: async () => {
          throw new Error('preflight unavailable');
        },
        summarize: () => {
          summaries += 1;
          throw new Error('summary unavailable');
        },
      }),
    ).rejects.toThrow('preflight unavailable');
    expect(summaries).toBe(1);
    expect(secondary).toHaveBeenCalledTimes(2);
    // On a successful run the finalization failure is the run's failure.
    summaries = 0;
    await expect(
      withVerificationReport({
        report: { status: 'running', completedAt: null, results: [] },
        groups: [],
        publish: () => {
          publications += 1;
          if (publications > 3) throw new Error('report disk full');
        },
        run: async () => {},
        summarize: () => {
          summaries += 1;
        },
      }),
    ).rejects.toThrow('report disk full');
    expect(summaries).toBe(1);
  } finally {
    secondary.mockRestore();
  }
});
