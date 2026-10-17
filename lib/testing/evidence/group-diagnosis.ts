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
  results: z.array(
    z.object({
      groupId: z.string(),
      status: z.enum(['passed', 'failed', 'blocked']),
      startedAt: z.string(),
      runKey: z.string().nullable(),
      reason: z.string().nullable().default(null),
    }),
  ),
});
type ArchivedReport = z.infer<typeof archivedReportSchema>;

/**
 * The attempt a diagnosis of the group names: its latest executed attempt that
 * the runner did not void. It must have failed and must have no browser run.
 */
export function diagnosableGroupAttempt(
  reports: readonly ArchivedReport[],
  groupId: string,
): { reportId: string; startedAt: string } {
  const attempts = reports
    .flatMap((report) => report.results.map((result) => ({ reportId: report.id, result })))
    .filter(
      ({ result }) => result.groupId === groupId && result.status !== 'blocked' && !voidedByDrift(result),
    )
    .sort((left, right) => left.result.startedAt.localeCompare(right.result.startedAt));
  const latest = attempts.at(-1);
  if (!latest) throw new Error(`No verification report holds an attempt of ${groupId}.`);
  if (latest.result.status !== 'failed')
    throw new Error(`The latest attempt of ${groupId} passed; there is no failure to classify.`);
  if (latest.result.runKey)
    throw new Error(
      `The latest attempt of ${groupId} is browser run ${latest.result.runKey}. Classify the run: bun run test:runs classify ${latest.result.runKey} ...`,
    );
  // Only a pass is ever reused into a later report, so a failure sits in the report that executed it.
  return { reportId: latest.reportId, startedAt: latest.result.startedAt };
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

/** Records the diagnosis of the group's latest failed attempt; a new diagnosis of the same attempt replaces the old one. */
export function recordGroupDiagnosis(
  archive: string,
  input: {
    groupId: string;
    classification: IncidentClass;
    rootCause: string;
    prevention: string;
    now: Date;
  },
): { reportId: string; diagnosis: GroupDiagnosis } {
  const reports = existsSync(archive)
    ? readdirSync(archive)
        .sort()
        .flatMap((directory) => {
          const file = resolve(archive, directory, 'report.json');
          return existsSync(file) ? [archivedReportSchema.parse(JSON.parse(readFileSync(file, 'utf8')))] : [];
        })
    : [];
  const attempt = diagnosableGroupAttempt(reports, input.groupId);
  const diagnosis = groupDiagnosisSchema.parse({
    groupId: input.groupId,
    startedAt: attempt.startedAt,
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
  return { reportId: attempt.reportId, diagnosis };
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
