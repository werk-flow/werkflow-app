/**
 * The recorded diagnosis of a failed group attempt that has no browser run: a
 * static, unit, SQL or component group. A browser run records its diagnosis in
 * its run manifest; these groups have none, so before 2026-10-03 an environment
 * failure of theirs (a leftover row in the local database failed `sql:security`)
 * stayed blocked until an unrelated input changed. The diagnosis lives beside the
 * report that holds the attempt, and only an `environment` class lets
 * `groupAttemptProblem` allow its one retry on unchanged inputs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomically } from '../runner/file-lock';
import { INCIDENT_CLASSES, type IncidentClass } from '../runner/run-policy';
import { groupAttemptKey, voidedByDrift, type GroupResult } from './group-evidence';

const DIAGNOSES_FILE = 'diagnoses.json';

const groupDiagnosisSchema = z.object({
  groupId: z.string().min(1),
  startedAt: z.string().datetime(),
  classification: z.enum(INCIDENT_CLASSES),
  classifiedAt: z.string().datetime(),
  rootCause: z.string().trim().min(1),
  prevention: z.string().trim().min(1),
});
export type GroupDiagnosis = z.infer<typeof groupDiagnosisSchema>;
const diagnosesSchema = z.array(groupDiagnosisSchema);

const archivedReportSchema = z.object({
  id: z.string(),
  target: z.string().default('local'),
  results: z.array(
    z.object({
      groupId: z.string(),
      status: z.enum(['passed', 'failed', 'blocked']),
      startedAt: z.string(),
      runKey: z.string().nullable(),
      reason: z.string().nullable().default(null),
      fingerprint: z.string().nullable().default(null),
      logPath: z.string().nullable().default(null),
    }),
  ),
});
type ArchivedReport = z.infer<typeof archivedReportSchema>;
type ArchivedResult = ArchivedReport['results'][number];

/** A failed attempt of a group without a browser run, and the report that executed it. */
export type DiagnosableAttempt = { reportId: string; target: string; result: ArchivedResult };

/**
 * The attempt a diagnosis of the group names: with a report id, the group's failed attempt in that
 * report, even when a later attempt passed (a failure repaired before its classification still gets
 * its class and incident entry); without one, its latest executed attempt. Attempts the runner
 * voided do not count. The attempt must have failed and must have no browser run.
 */
export function diagnosableGroupAttempt(
  reports: readonly ArchivedReport[],
  groupId: string,
  reportId?: string,
): DiagnosableAttempt {
  const attempts = reports
    .filter((report) => reportId === undefined || report.id === reportId)
    .flatMap((report) =>
      report.results.map((result) => ({ reportId: report.id, target: report.target, result })),
    )
    .filter(
      ({ result }) => result.groupId === groupId && result.status !== 'blocked' && !voidedByDrift(result),
    )
    .sort((left, right) => left.result.startedAt.localeCompare(right.result.startedAt));
  const chosen = reportId === undefined ? attempts.at(-1) : attempts.find(isFailed);
  const where = reportId === undefined ? 'The latest attempt' : `The attempt in report ${reportId}`;
  if (!chosen)
    throw new Error(
      reportId === undefined
        ? `No verification report holds an attempt of ${groupId}.`
        : `Report ${reportId} holds no executed failed attempt of ${groupId}.`,
    );
  if (!isFailed(chosen)) throw new Error(`${where} of ${groupId} passed; there is no failure to classify.`);
  if (chosen.result.runKey)
    throw new Error(
      `${where} of ${groupId} is browser run ${chosen.result.runKey}. Classify the run: bun run test:runs classify ${chosen.result.runKey} ...`,
    );
  // Only a pass is ever reused into a later report, so a failure sits in the report that executed it.
  return chosen;
}

function isFailed(attempt: { result: ArchivedResult }): boolean {
  return attempt.result.status === 'failed';
}

function readReportDiagnoses(reportDirectory: string): GroupDiagnosis[] {
  const file = resolve(reportDirectory, DIAGNOSES_FILE);
  return existsSync(file) ? diagnosesSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : [];
}

export function readGroupDiagnoses(archive: string): GroupDiagnosis[] {
  if (!existsSync(archive)) return [];
  return readdirSync(archive, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readReportDiagnoses(resolve(archive, entry.name)));
}

/**
 * Records the diagnosis of the group's failed attempt (`diagnosableGroupAttempt`); a new diagnosis
 * of the same attempt replaces the old one. A report id reads that report alone.
 */
export function recordGroupDiagnosis(
  archive: string,
  input: {
    groupId: string;
    reportId?: string;
    classification: IncidentClass;
    rootCause: string;
    prevention: string;
    now: Date;
  },
): { attempt: DiagnosableAttempt; diagnosis: GroupDiagnosis } {
  if (input.reportId !== undefined && !/^[\w-]+$/.test(input.reportId))
    throw new Error(
      `${input.reportId} is no report id: give the folder name under .agent-logs/verification.`,
    );
  const directories = !existsSync(archive)
    ? []
    : input.reportId === undefined
      ? readdirSync(archive).sort()
      : [input.reportId];
  const reports = directories.flatMap((directory) => {
    const file = resolve(archive, directory, 'report.json');
    return existsSync(file) ? [archivedReportSchema.parse(JSON.parse(readFileSync(file, 'utf8')))] : [];
  });
  const attempt = diagnosableGroupAttempt(reports, input.groupId, input.reportId);
  const diagnosis = groupDiagnosisSchema.parse({
    groupId: input.groupId,
    startedAt: attempt.result.startedAt,
    classification: input.classification,
    classifiedAt: input.now.toISOString(),
    rootCause: input.rootCause,
    prevention: input.prevention,
  });
  const reportDirectory = resolve(archive, attempt.reportId);
  const kept = readReportDiagnoses(reportDirectory).filter(
    (existing) => groupAttemptKey(existing) !== groupAttemptKey(diagnosis),
  );
  writeJsonAtomically(resolve(reportDirectory, DIAGNOSES_FILE), [...kept, diagnosis]);
  return { attempt, diagnosis };
}

/** Group kinds whose failed attempt needs a recorded diagnosis before `test:verify` starts again. */
export const DIAGNOSED_ATTEMPT_KINDS: ReadonlySet<string> = new Set(['unit', 'sql', 'ui']);

/**
 * `test:verify` refuses to start while the latest attempt of a unit, SQL or component group it would
 * run failed without a recorded diagnosis, as it does for browser runs (`unclassifiedFailureProblem`):
 * otherwise a changed input reruns the group and the failure leaves no class. Static gates are
 * exempt: they are deterministic over their inputs, so their failure is the author's current work
 * and its message names the cause.
 */
export function undiagnosedAttemptProblem(input: {
  groupIds: readonly string[];
  results: readonly Pick<GroupResult, 'groupId' | 'status' | 'startedAt' | 'runKey' | 'reason'>[];
  diagnoses: readonly GroupDiagnosis[];
}): string | undefined {
  const diagnosed = new Set(input.diagnoses.map((diagnosis) => groupAttemptKey(diagnosis)));
  const open = input.groupIds.filter((groupId) => {
    const latest = input.results
      .filter((result) => result.groupId === groupId && result.status !== 'blocked' && !voidedByDrift(result))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .at(-1);
    return latest?.status === 'failed' && !latest.runKey && !diagnosed.has(groupAttemptKey(latest));
  });
  if (!open.length) return undefined;
  return `Diagnose the latest failed attempt of ${open.join(', ')} first: bun run test:runs classify <group-id> <class> "<cause>" "<prevention>".`;
}

/** A product or harness cause needs a change, which changes the inputs anyway; only an environment cause allows the retry. */
export function recoveredGroupAttempts(diagnoses: readonly GroupDiagnosis[]): string[] {
  return diagnoses
    .filter((diagnosis) => diagnosis.classification === 'environment')
    .map((diagnosis) => groupAttemptKey(diagnosis));
}
