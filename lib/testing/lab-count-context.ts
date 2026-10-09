import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { contentDigest } from './evidence/source-content';
import { LAB_MEASUREMENT_VERSION } from './lab-record';
import type { LabStep } from './lab-steps';
import { MEASURED_SCENARIOS } from './measured-scenarios';
import { measuredTestSource } from './measured-test-source';
import { workloadDigest } from './performance-context';

/**
 * The identity of a lab record (docs/technical/performance.md). The recorder
 * imports this module, never the reference file, so lowering or accepting a
 * reference does not change the test inputs of the lab groups.
 */

/**
 * The support modules every lab step runs through. Their whole content is part
 * of each lab measurement digest, so a changed recorder orphans the references
 * until they are re-recorded or carried over with a reason.
 */
const LAB_SUPPORT_FILES = [
  'tests/audit/support/lab-probe.ts',
  'tests/audit/support/lab-network.ts',
  'tests/audit/support/lab-recorder.ts',
] as const;

/** The identity of a step's measured code: the step contract, the tests that record it, and the recorder. */
export function labMeasurementDigest(repositoryRoot: string, step: LabStep): string {
  const digest = createHash('sha256').update(
    JSON.stringify({
      version: LAB_MEASUREMENT_VERSION,
      id: step.id,
      stepVersion: step.version,
      role: step.role,
      kind: step.kind,
      viewport: step.viewport,
      cpuThrottle: step.cpuThrottle,
    }),
  );
  const measured = measuredTestSource(
    step.file,
    readFileSync(resolve(repositoryRoot, step.file), 'utf8'),
    step.id,
  );
  digest.update(`${step.file}#${step.id}`).update('\0').update(measured).update('\0');
  for (const file of LAB_SUPPORT_FILES)
    digest
      .update(file)
      .update('\0')
      .update(contentDigest(file, readFileSync(resolve(repositoryRoot, file))))
      .update('\0');
  return digest.digest('hex');
}

/**
 * The typical profile's workload identity, the one the wall-clock scenarios
 * use: the profile generator and the archived actual counts of the run.
 */
export function labWorkloadDigest(repositoryRoot: string, evidenceDirectory: string): string {
  const typical = MEASURED_SCENARIOS.find((scenario) => scenario.profile === 'typical');
  if (!typical) throw new Error('No typical-profile scenario names the typical workload.');
  return workloadDigest(repositoryRoot, typical, evidenceDirectory);
}
