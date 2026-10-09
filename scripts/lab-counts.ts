import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { resolve } from 'node:path';

import { captureInputSnapshot } from '../lib/testing/evidence/group-evidence';
import { createGroupQualification } from '../lib/testing/evidence/group-qualification';
import {
  acceptLabChange,
  compareLabStep,
  findLabReference,
  formatLabTable,
  initialLabReference,
  labReferenceProblems,
  labReferencesSchema,
  ratchetLabReference,
  ungateLabMetric,
  stabilityOfCounts,
  type LabReferences,
} from '../lib/testing/lab-counts';
import { type LabObservation } from '../lib/testing/lab-record';
import { readLabObservations } from '../lib/testing/lab-evidence';
import { getLabStep, LAB_METRICS, LAB_STEPS, type LabMetric } from '../lib/testing/lab-steps';
import { getGroupTimingRequirements, getTestGroups } from '../lib/testing/selection/test-groups';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { loadEnvLocal } from '../tests/golden/support/env';
import { readRunManifest, runDirectory } from '../tests/golden/support/run-state';

// The only writer of lib/testing/lab-count-references.json
// (docs/technical/performance.md, "Change a lab reference"). Every command
// reads passing, cleaned group runs of one build on the current inputs.
//
//   bun scripts/lab-counts.ts report --runs <keys>
//   bun scripts/lab-counts.ts gate --metric <m> --stability "<spread>" --relevance "<experiment>" --runs <keys>
//   bun scripts/lab-counts.ts reject --metric <m> --job stability|relevance --evidence "<why>" --runs <keys>
//   bun scripts/lab-counts.ts calibrate --runs <five keys> --reason "<basis>"
//   bun scripts/lab-counts.ts ratchet --run <key>
//   bun scripts/lab-counts.ts accept --run <key> --step <id> --target <metric or shape> --reason "<what changed>"
//   bun scripts/lab-counts.ts ungate --runs <keys> --step <id> --metric <m> --reason "<the two values it took>"

const root = resolve(import.meta.dir, '..');
const REFERENCE_PATH = resolve(root, 'lib/testing/lab-count-references.json');
const [command = '', ...rest] = process.argv.slice(2);
const values = new Map<string, string>();
while (rest.length) {
  const name = rest.shift() ?? '';
  const value = rest.shift();
  if (!name.startsWith('--') || !value || value.startsWith('--') || values.has(name))
    throw new Error(`Unexpected argument ${name}; see the usage in scripts/lab-counts.ts.`);
  values.set(name, value);
}

function required(name: string): string {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`${command} needs ${name}.`);
  return value;
}

function runKeys(name: '--runs' | '--run'): string[] {
  const keys = required(name).split(',').filter(Boolean);
  if (keys.some((key) => !/^\d{4}-\d{2}-\d{2}T\d{9}Z-[a-f0-9]+$/.test(key)))
    throw new Error('Lab commands take exact run keys, not paths.');
  return keys;
}

type QualifiedRun = { runKey: string; buildId: string; observations: LabObservation[] };

/** Refuses failed, uncleaned, diagnostic, stale or malformed runs, as the calibration of wall-clock references does. */
function qualifiedRuns(keys: readonly string[]): QualifiedRun[] {
  const groups = getTestGroups(root);
  const qualification = createGroupQualification(root, groups, captureInputSnapshot(root));
  return keys.map((runKey) => {
    const manifest = readRunManifest(runKey);
    const group = groups.find((entry) => entry.id === manifest.groupId);
    if (!group || !manifest.buildId) throw new Error(`${runKey} has no registered group or build identity.`);
    const requiredSteps = getGroupTimingRequirements(group, root).requiredLabSteps ?? [];
    if (!requiredSteps.length) throw new Error(`${runKey} is not a run of a lab group.`);
    if (manifest.status !== 'passed' || !manifest.cleanedAt || manifest.lane !== 'group')
      throw new Error(`${runKey} is not a passing, cleaned group run.`);
    if (manifest.groupFingerprint !== qualification.qualify(group).fingerprint)
      throw new Error(`${runKey} ran on other test inputs than the current tree.`);
    const { observations, problems } = readLabObservations(runDirectory(runKey));
    if (problems.length) throw new Error(`${runKey}: ${problems.join('; ')}`);
    const missing = requiredSteps.filter(
      (id) => observations.filter((entry) => entry.stepId === id).length !== 1,
    );
    if (missing.length) throw new Error(`${runKey} lacks one record each of ${missing.join(', ')}.`);
    return { runKey, buildId: manifest.buildId, observations };
  });
}

function oneBuild(runs: readonly QualifiedRun[]): string {
  const builds = new Set(runs.map((run) => run.buildId));
  const [buildId] = builds;
  if (builds.size !== 1 || !buildId) throw new Error('Every run must come from one build.');
  return buildId;
}

/** Read from disk inside the workspace lock, so two commands never write over each other's update. */
function readReferences(): LabReferences {
  return labReferencesSchema.parse(JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')));
}

/** Writes the references in the repository's Prettier format, through a temporary file. */
async function writeReferences(references: LabReferences): Promise<void> {
  const problems = labReferenceProblems(labReferencesSchema.parse(references), LAB_STEPS);
  if (problems.length) throw new Error(`Refusing invalid lab references: ${problems.join('; ')}`);
  const options = (await resolveConfig(REFERENCE_PATH)) ?? {};
  const text = await format(JSON.stringify(references), { ...options, filepath: REFERENCE_PATH });
  const temporary = `${REFERENCE_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, REFERENCE_PATH);
  console.log(`Wrote ${REFERENCE_PATH}. Commit it with the change it records.`);
}

function metricArgument(): LabMetric {
  const metric = required('--metric');
  const known = LAB_METRICS.find((candidate) => candidate === metric);
  if (!known) throw new Error(`Unknown lab metric ${metric}.`);
  return known;
}

function report(runs: readonly QualifiedRun[]): void {
  const stepIds = [...new Set(runs.flatMap((run) => run.observations.map((entry) => entry.stepId)))];
  for (const stepId of stepIds) {
    const observations = runs.flatMap((run) => run.observations.filter((entry) => entry.stepId === stepId));
    console.log(`${stepId} over ${observations.length} runs: metric | min | max | median | tolerance`);
    for (const row of stabilityOfCounts(observations))
      console.log(
        `  ${row.target} | ${row.min} | ${row.max} | ${row.median} | ${row.tolerance ?? 'unstable'}`,
      );
    const shapes = [
      ...new Set(observations.flatMap((entry) => entry.payloads.map((payload) => payload.shape))),
    ];
    for (const shape of shapes) {
      const bytes = observations.map(
        (entry) => entry.payloads.find((payload) => payload.shape === shape)?.decodedBytes ?? null,
      );
      console.log(`  ${shape} decoded bytes: ${bytes.map((value) => value ?? '—').join(', ')}`);
    }
    const clocks = observations.map((entry) => Math.round(entry.wallClockMs));
    console.log(`  wall clock ms: ${clocks.join(', ')}`);
    const references = readReferences();
    for (const observation of observations) {
      const reference = findLabReference(references, observation);
      if (reference)
        for (const line of formatLabTable(
          stepId,
          compareLabStep({ step: getLabStep(stepId), observation, reference }),
          observation.wallClockMs,
        ))
          console.log(line);
    }
  }
}

await withWorkspaceTestLock({ operation: `lab counts: ${command}` }, async () => {
  loadEnvLocal();
  const references = readReferences();
  switch (command) {
    case 'report':
      report(qualifiedRuns(runKeys('--runs')));
      return;
    case 'gate': {
      const metric = metricArgument();
      const keys = runKeys('--runs');
      // Gate and reject evidence comes from passing runs of one build.
      oneBuild(qualifiedRuns(keys));
      await writeReferences({
        ...references,
        gatedMetrics: [
          ...references.gatedMetrics.filter((entry) => entry.metric !== metric),
          { metric, stability: required('--stability'), relevance: required('--relevance'), runKeys: keys },
        ],
        rejectedMetrics: references.rejectedMetrics.filter((entry) => entry.metric !== metric),
      });
      return;
    }
    case 'reject': {
      const metric = metricArgument();
      const job = required('--job');
      if (job !== 'stability' && job !== 'relevance') throw new Error('--job is stability or relevance.');
      const keys = runKeys('--runs');
      // Gate and reject evidence comes from passing runs of one build.
      oneBuild(qualifiedRuns(keys));
      await writeReferences({
        ...references,
        gatedMetrics: references.gatedMetrics.filter((entry) => entry.metric !== metric),
        rejectedMetrics: [
          ...references.rejectedMetrics.filter((entry) => entry.metric !== metric),
          { metric, job, evidence: required('--evidence'), runKeys: keys },
        ],
        steps: references.steps.map((step) => {
          const counts = { ...step.counts };
          delete counts[metric];
          return { ...step, counts };
        }),
      });
      return;
    }
    case 'calibrate': {
      const keys = runKeys('--runs');
      const runs = qualifiedRuns(keys);
      const buildId = oneBuild(runs);
      required('--reason');
      const gated = references.gatedMetrics.map((entry) => entry.metric);
      const stepIds = [...new Set(runs.flatMap((run) => run.observations.map((entry) => entry.stepId)))];
      let steps = references.steps;
      for (const stepId of stepIds) {
        const step = getLabStep(stepId);
        const { reference, unstable } = initialLabReference({
          step,
          observations: runs.flatMap((run) => run.observations.filter((entry) => entry.stepId === stepId)),
          runKeys: keys,
          buildId,
          gated,
        });
        if (unstable.length) console.log(`${stepId} left ungated: ${unstable.join('; ')}`);
        steps = [
          ...steps.filter(
            // A recalibration supersedes every earlier reference of the step.
            (candidate) => candidate.stepId !== stepId,
          ),
          reference,
        ];
      }
      await writeReferences({ ...references, steps });
      return;
    }
    case 'ungate': {
      const keys = runKeys('--runs');
      const runs = qualifiedRuns(keys);
      oneBuild(runs);
      const stepId = required('--step');
      const metric = metricArgument();
      if (runs.some((run) => !run.observations.some((entry) => entry.stepId === stepId)))
        throw new Error(`Every evidence run must have recorded ${stepId}.`);
      if (!references.steps.some((reference) => reference.stepId === stepId))
        throw new Error(`No lab reference names ${stepId}.`);
      await writeReferences({
        ...references,
        steps: references.steps.map((reference) =>
          reference.stepId === stepId
            ? ungateLabMetric({ reference, metric, runKeys: keys, reason: required('--reason') })
            : reference,
        ),
      });
      return;
    }
    case 'ratchet': {
      const [run] = qualifiedRuns(runKeys('--run'));
      if (!run) return;
      await writeReferences({
        ...references,
        steps: references.steps.map((reference) => {
          const observation = run.observations.find((entry) =>
            findLabReference({ ...references, steps: [reference] }, entry),
          );
          return observation ? ratchetLabReference(reference, observation, run.runKey) : reference;
        }),
      });
      return;
    }
    case 'accept': {
      const [run] = qualifiedRuns(runKeys('--run'));
      const stepId = required('--step');
      const observation = run?.observations.find((entry) => entry.stepId === stepId);
      if (!run || !observation) throw new Error(`The run recorded no ${stepId}.`);
      const reference = findLabReference(references, observation);
      if (!reference) throw new Error(`${stepId} has no reference in this context; calibrate it first.`);
      await writeReferences({
        ...references,
        steps: references.steps.map((candidate) =>
          candidate === reference
            ? acceptLabChange({
                reference,
                observation,
                target: required('--target'),
                runKey: run.runKey,
                reason: required('--reason'),
              })
            : candidate,
        ),
      });
      return;
    }
    default:
      throw new Error(
        'Use report, gate, reject, calibrate, ungate, ratchet or accept; see scripts/lab-counts.ts.',
      );
  }
});
