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
} from './group-diagnosis';

const failedSql = {
  groupId: 'sql:security',
  status: 'failed' as const,
  startedAt: '2026-10-03T10:00:00.000Z',
  runKey: null,
  reason: 'Command exited 1',
};
const reports = [
  {
    id: 'report-a',
    results: [{ ...failedSql, status: 'passed' as const, startedAt: '2026-10-02T10:00:00.000Z' }],
  },
  { id: 'report-b', results: [failedSql] },
  {
    id: 'report-c',
    results: [
      { ...failedSql, status: 'blocked' as const, startedAt: '2026-10-03T11:00:00.000Z' },
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
    startedAt: failedSql.startedAt,
  });
  expect(() => diagnosableGroupAttempt(reports.slice(0, 1), 'sql:security')).toThrow('passed');
  expect(() => diagnosableGroupAttempt(reports, 'unit:all')).toThrow('No verification report');
  const browser = [{ id: 'report-d', results: [{ ...failedSql, groupId: 'golden:p1-01', runKey: 'run-1' }] }];
  expect(() => diagnosableGroupAttempt(browser, 'golden:p1-01')).toThrow('Classify the run');
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
  expect(record('product').reportId).toBe('report-b');
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
      now: new Date(),
    }),
  ).toThrow();
});
