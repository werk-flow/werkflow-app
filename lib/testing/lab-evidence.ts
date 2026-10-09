import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import carryoverFile from './lab-count-reference-carryover.json';
import referenceFile from './lab-count-references.json';
import {
  carryOverLabReferences,
  compareLabStep,
  findLabReference,
  formatLabTable,
  isFailingRow,
  labCarryoverSchema,
  labReferenceProblems,
  labReferencesSchema,
  type LabReferences,
} from './lab-counts';
import {
  LAB_ARCHIVE,
  LAB_MEASUREMENT_VERSION,
  labObservationSchema,
  type LabObservation,
} from './lab-record';
import { LAB_STEPS, type LabStep } from './lab-steps';

export function readLabReferences(): LabReferences {
  const references = carryOverLabReferences(
    labReferencesSchema.parse(referenceFile),
    labCarryoverSchema.parse(carryoverFile),
  );
  const problems = labReferenceProblems(references, LAB_STEPS);
  if (problems.length) throw new Error(`Invalid lab references: ${problems.join('; ')}`);
  return references;
}

export function readLabObservations(directory: string): {
  observations: LabObservation[];
  problems: string[];
} {
  const path = resolve(directory, LAB_ARCHIVE);
  if (!existsSync(path)) return { observations: [], problems: [] };
  const observations: LabObservation[] = [];
  const problems: string[] = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line, index) => {
      try {
        observations.push(labObservationSchema.parse(JSON.parse(line)));
      } catch (error) {
        problems.push(
          `${LAB_ARCHIVE} line ${index + 1} is malformed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  return { observations, problems };
}

export const labEvidenceSchema = z.object({
  steps: z.number().int().nonnegative(),
  table: z.array(z.string()),
  problems: z.array(z.string()),
  overTarget: z.array(z.string()),
});
export type LabEvidenceCheck = z.infer<typeof labEvidenceSchema>;

/**
 * Judges the lab records of one group run. Missing, duplicated or malformed
 * records fail in every mode. Ceilings, budgets, floors and shape changes fail
 * when `enforceCeilings` (release mode or an explicit `--group`); elsewhere
 * they are notes. An improvement that was not ratcheted fails in release mode.
 */
export function checkLabEvidence(input: {
  directory: string;
  runKey: string;
  requiredSteps: readonly string[];
  enforceCeilings: boolean;
  release: boolean;
  references?: LabReferences;
  steps?: readonly LabStep[];
}): LabEvidenceCheck {
  const { directory, runKey, requiredSteps, enforceCeilings, release } = input;
  const references = input.references ?? readLabReferences();
  const { observations, problems } = readLabObservations(directory);
  const overTarget: string[] = [];
  const table: string[] = [];
  for (const stepId of requiredSteps) {
    const step = (input.steps ?? LAB_STEPS).find((candidate) => candidate.id === stepId);
    if (!step) {
      problems.push(`${stepId} is required by the group but is not a registered lab step`);
      continue;
    }
    const records = observations.filter((observation) => observation.stepId === stepId);
    const [observation] = records;
    if (records.length !== 1 || !observation) {
      problems.push(`${stepId} recorded ${records.length} lab records; a run records each step once`);
      continue;
    }
    if (
      observation.stepVersion !== step.version ||
      observation.labMeasurementVersion !== LAB_MEASUREMENT_VERSION
    ) {
      problems.push(`${stepId} was recorded for another step or recorder version`);
      continue;
    }
    const reference = findLabReference(references, observation);
    if (!reference) {
      const note = `${stepId} has no reviewed lab reference for this context; record one with bun scripts/lab-counts.ts calibrate`;
      if (step.comparison === 'required' && release) problems.push(note);
      else overTarget.push(note);
      table.push(...formatLabTable(stepId, [], observation.wallClockMs));
      continue;
    }
    const rows = compareLabStep({ step, observation, reference });
    table.push(...formatLabTable(stepId, rows, observation.wallClockMs));
    for (const row of rows.filter((candidate) => isFailingRow(candidate, true))) {
      const message =
        row.status === 'ratchet-pending'
          ? `${stepId} ${row.target} fell to ${row.now} below its reference ${row.reference}: lower the reference with bun scripts/lab-counts.ts ratchet --run ${runKey}`
          : row.status === 'shrank'
            ? `${stepId} ${row.target} shrank to ${row.now} below its floor ${row.floor}: confirm nothing is missing, then bun scripts/lab-counts.ts accept --run ${runKey} --step ${stepId} --target ${row.target.split('#')[0]} --reason "<what changed>"`
            : `${stepId} ${row.target} is ${row.status}: ${row.now ?? 'absent'} against reference ${row.reference ?? 'none'} (ceiling ${row.ceiling ?? '—'})`;
      if (row.status === 'ratchet-pending') (release ? problems : overTarget).push(message);
      else (enforceCeilings ? problems : overTarget).push(message);
    }
  }
  const extra = observations.filter((observation) => !requiredSteps.includes(observation.stepId));
  for (const observation of extra) problems.push(`${observation.stepId} is not a step of this group`);
  return { steps: observations.length, table, problems, overTarget };
}
