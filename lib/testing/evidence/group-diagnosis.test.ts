import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupAttemptKey, INPUT_DRIFT_REASON } from './group-evidence';
import {
  diagnosableGroupAttempt,
  readGroupDiagnoses,
  recordGroupDiagnosis,
  recoveredGroupAttempts,
  undiagnosedAttemptProblem,
} from './group-diagnosis';

type Report = Parameters<typeof diagnosableGroupAttempt>[0][number];
type Result = Report['results'][number];
const failedSql: Result = {
  groupId: 'sql:security',
  status: 'failed',
  startedAt: '2026-10-03T10:00:00.000Z',
  runKey: null,
  reason: 'Command exited 1',
  fingerprint: 'f'.repeat(64),
  logPath: null,
};
const reports: Report[] = [
  {
    id: 'report-a',
    target: 'local',
    results: [{ ...failedSql, status: 'passed', startedAt: '2026-10-02T10:00:00.000Z' }],
  },
  { id: 'report-b', target: 'local', results: [failedSql] },
  {
    id: 'report-c',
    target: 'local',
    results: [
      { ...failedSql, status: 'blocked', startedAt: '2026-10-03T11:00:00.000Z' },
      { ...failedSql, startedAt: '2026-10-03T12:00:00.000Z', reason: `${INPUT_DRIFT_REASON}: lib/x.ts` },
    ],
  },
];

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('a diagnosis names the latest executed failure of a group without a browser run', () => {
  // Blocked and drift-voided results are no attempts, so the failure in report-b is the one diagnosed.
  expect(diagnosableGroupAttempt(reports, 'sql:security')).toEqual({
    reportId: 'report-b',
    target: 'local',
    result: failedSql,
  });
  expect(() => diagnosableGroupAttempt(reports.slice(0, 1), 'sql:security')).toThrow('passed');
  expect(() => diagnosableGroupAttempt(reports, 'unit:all')).toThrow('No verification report');
  const browser: Report[] = [
    {
      id: 'report-d',
      target: 'local',
      results: [{ ...failedSql, groupId: 'golden:p1-01', runKey: 'run-1' }],
    },
  ];
  expect(() => diagnosableGroupAttempt(browser, 'golden:p1-01')).toThrow('Classify the run');
});

test('probe: a failed attempt named by its report stays classifiable after a later pass', () => {
  const repaired: Report[] = [
    ...reports,
    {
      id: 'report-e',
      target: 'local',
      results: [{ ...failedSql, status: 'passed', startedAt: '2026-10-04T10:00:00.000Z' }],
    },
  ];
  expect(() => diagnosableGroupAttempt(repaired, 'sql:security')).toThrow('passed');
  expect(diagnosableGroupAttempt(repaired, 'sql:security', 'report-b').result).toEqual(failedSql);
  // The named report must hold an executed failure of the group: a pass, a blocked or voided attempt does not.
  expect(() => diagnosableGroupAttempt(repaired, 'sql:security', 'report-e')).toThrow('no executed failed');
  expect(() => diagnosableGroupAttempt(repaired, 'sql:security', 'report-c')).toThrow('no executed failed');
  expect(() => diagnosableGroupAttempt(repaired, 'sql:security', 'report-x')).toThrow('no executed failed');
});

test('the diagnosis is stored beside its report, replaces an earlier one of the attempt, and only environment recovers', () => {
  const archive = mkdtempSync(join(tmpdir(), 'group-diagnosis-'));
  directories.push(archive);
  for (const report of reports) {
    mkdirSync(join(archive, report.id));
    writeFileSync(join(archive, report.id, 'report.json'), JSON.stringify(report));
  }
  const record = (classification: 'product' | 'environment') =>
    recordGroupDiagnosis(archive, {
      groupId: 'sql:security',
      classification,
      rootCause: 'A committed test user stayed in the local database.',
      prevention: 'SQL tests run only through the runner.',
      now: new Date('2026-10-03T13:00:00.000Z'),
    });
  expect(record('product').attempt.reportId).toBe('report-b');
  expect(recoveredGroupAttempts(readGroupDiagnoses(archive))).toEqual([]);
  record('environment');
  expect(JSON.parse(readFileSync(join(archive, 'report-b', 'diagnoses.json'), 'utf8'))).toHaveLength(1);
  expect(recoveredGroupAttempts(readGroupDiagnoses(archive))).toEqual([groupAttemptKey(failedSql)]);
  expect(() =>
    recordGroupDiagnosis(archive, {
      groupId: 'sql:security',
      classification: 'environment',
      rootCause: ' ',
      prevention: 'x',
      now: new Date('2026-10-05T10:00:00.000Z'),
    }),
  ).toThrow();
  // A named report is read alone, and only a folder name can name it.
  const named = recordGroupDiagnosis(archive, {
    groupId: 'sql:security',
    reportId: 'report-b',
    classification: 'harness',
    rootCause: 'cause',
    prevention: 'Tier 3: judgment',
    now: new Date('2026-10-05T10:00:00.000Z'),
  });
  expect(named.attempt.reportId).toBe('report-b');
  expect(JSON.parse(readFileSync(join(archive, 'report-b', 'diagnoses.json'), 'utf8'))).toHaveLength(1);
  expect(() =>
    recordGroupDiagnosis(archive, {
      groupId: 'sql:security',
      reportId: '../report-b',
      classification: 'harness',
      rootCause: 'cause',
      prevention: 'prevention',
      now: new Date('2026-10-05T10:00:00.000Z'),
    }),
  ).toThrow('no report id');
});

test('verification waits for the diagnosis of a failed unit, SQL or component attempt', () => {
  type AttemptInput = Parameters<typeof undiagnosedAttemptProblem>[0];
  const problemFor = (
    results: AttemptInput['results'],
    diagnoses: AttemptInput['diagnoses'] = [],
    groupIds: AttemptInput['groupIds'] = ['sql:security'],
  ): string | undefined => undiagnosedAttemptProblem({ groupIds, results, diagnoses });
  const results = reports.flatMap((report): AttemptInput['results'] => report.results);
  const diagnosis: AttemptInput['diagnoses'][number] = {
    groupId: 'sql:security',
    startedAt: failedSql.startedAt,
    classification: 'harness',
    classifiedAt: '2026-10-03T13:00:00.000Z',
    rootCause: 'cause',
    prevention: 'prevention',
  };
  // The latest executed attempt failed: blocked and drift-voided results do not hide it.
  expect(problemFor(results)).toContain('sql:security');
  expect(problemFor(results, [diagnosis])).toBeUndefined();
  // A diagnosis of an earlier attempt does not cover the latest one.
  const later = { ...failedSql, startedAt: '2026-10-04T10:00:00.000Z' };
  expect(problemFor([...results, later], [diagnosis])).toContain('sql:security');
  // A later pass closes the failure; a group the plan does not run is not asked about.
  expect(problemFor([...results, { ...later, status: 'passed' }])).toBeUndefined();
  expect(problemFor(results, [], ['unit:all'])).toBeUndefined();
  // A browser attempt is classified through its run (unclassifiedFailureProblem).
  expect(problemFor([{ ...later, runKey: 'run-1' }])).toBeUndefined();
});
