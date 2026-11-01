import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  INCIDENT_CLASSES,
  PLAYWRIGHT_LANES,
  PLAYWRIGHT_SUITES,
  PLAYWRIGHT_TARGETS,
  defaultTargetForSuite,
  type IncidentClass,
  type PlaywrightLane,
  type PlaywrightSuite,
  type PlaywrightTarget,
} from '../../../lib/testing/runner/run-policy';
import { withFileLock, writeJsonAtomically } from '../../../lib/testing/runner/file-lock';
import { assertWorldSeedComplete } from '../../../lib/testing/seed-world-plan';
import { backendIdentity } from '../../../lib/testing/evidence/proof-environment';
import { workspaceAppOrigin } from '../../../lib/testing/runner/app-port';
import {
  browserRunPaths,
  configuredRunKey,
  manifestActiveStateDirectory,
} from '../../../lib/testing/runs/run-paths';
import {
  mirrorOwnedStateFiles,
  readRetainedWorldState,
  restoreRetainedWorkloads,
} from '../../../lib/testing/runs/archive-state';
import {
  backendOriginFromUrl,
  validateDiagnosticProvenance,
  type BackendProvenance,
  type TestOutcomeEvidence,
} from '../../../lib/testing/evidence/test-evidence';
import { assertRetainedBusinessDate } from '../../../lib/testing/runner/business-date';
import type { DiagnosticWorld } from '../../../lib/testing/runner/group-recovery';
import {
  assertInterruptedRecoveryOwnership,
  archiveRecoveryActiveState,
  recoverInterruptedEvidence,
  type InterruptionRecovery,
} from '../../../lib/testing/runner/interrupted-run-recovery';
import { errorCode } from '../../../lib/testing/runner/error-code';
import { artifactsDirectory, loadWorld, type TestWorld, worldFilePath } from './world';
import { worldUserIds } from './seed';

const ARCHIVED_RUN_STATUSES = [
  'starting',
  'running',
  'passed',
  'failed',
  'timedout',
  'interrupted',
  'failed_retained',
  'diagnostic_passed',
] as const;
type ArchivedRunStatus = (typeof ARCHIVED_RUN_STATUSES)[number];

export type RunFailure = {
  title: string;
  file: string | null;
  message: string;
  testId?: string;
};

export type RunManifest = {
  version: 1;
  artifactLayout?: 'run-owned-v1';
  groupId?: string | undefined;
  groupFingerprint?: string | undefined;
  runKey: string;
  sourceRunKey: string | null;
  /** A diagnostic's world; absent on other runs and on replays recorded before 2026-10-16. */
  diagnosticWorld?: DiagnosticWorld | undefined;
  lane: PlaywrightLane;
  suite: PlaywrightSuite;
  // Absent on manifests archived before the local-stack split (Stage A,
  // 2026-08-28); those runs were all cloud runs.
  target?: PlaywrightTarget;
  grep: string | null;
  command: string;
  status: ArchivedRunStatus;
  startedAt: string;
  completedAt: string | null;
  gitHead: string;
  sourceFingerprint: string;
  candidateFingerprint?: string | undefined;
  buildId: string | null;
  baseUrl: string;
  projectRef: string;
  r2Bucket: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: RunFailure[];
  world: {
    runId: string;
    organizationIds: string[];
    userIds: string[];
  } | null;
  retainedAt: string | null;
  cleanedAt: string | null;
  classification: IncidentClass | null;
  classifiedAt: string | null;
  rootCause: string | null;
  prevention: string | null;
  /** Retired certification-lane fields, kept so historical manifests parse. */
  rerunOverrideReason: string | null;
  campaignId?: string;
  rerunGrantId?: string | null;
  backendProvenance?: BackendProvenance;
  selectedTestIds?: string[];
  outcomes?: TestOutcomeEvidence[];
  currentTestId?: string | null;
  currentTestStartedAt?: string | null;
  interruptionRecovery?: InterruptionRecovery;
  businessDate?: string | undefined;
  /** Traces, reports and active state removed by `test:runs prune`; evidence files stay. */
  prunedAt?: string | null;
  auditGroup?: string;
  completedAuditGroups?: Array<{
    group: string;
    runId: string;
    organizationIds: string[];
    cleanedAt: string;
  }>;
};

/*
 * A manifest file as RunManifest declares it. Loose objects keep keys this
 * type does not name, so a rewrite through updateRunManifest drops nothing.
 */
const runManifestSchema: z.ZodType<RunManifest> = z.looseObject({
  version: z.literal(1),
  artifactLayout: z.literal('run-owned-v1').exactOptional(),
  groupId: z.string().optional(),
  groupFingerprint: z.string().optional(),
  runKey: z.string(),
  sourceRunKey: z.string().nullable(),
  diagnosticWorld: z.enum(['retained', 'fresh']).optional(),
  lane: z.enum(PLAYWRIGHT_LANES),
  suite: z.enum(PLAYWRIGHT_SUITES),
  target: z.enum(PLAYWRIGHT_TARGETS).exactOptional(),
  grep: z.string().nullable(),
  command: z.string(),
  status: z.enum(ARCHIVED_RUN_STATUSES),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  gitHead: z.string(),
  sourceFingerprint: z.string(),
  candidateFingerprint: z.string().optional(),
  buildId: z.string().nullable(),
  baseUrl: z.string(),
  projectRef: z.string(),
  r2Bucket: z.string(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  failures: z.array(
    z.looseObject({
      title: z.string(),
      file: z.string().nullable(),
      message: z.string(),
      testId: z.string().exactOptional(),
    }),
  ),
  world: z
    .looseObject({ runId: z.string(), organizationIds: z.array(z.string()), userIds: z.array(z.string()) })
    .nullable(),
  retainedAt: z.string().nullable(),
  cleanedAt: z.string().nullable(),
  classification: z.enum(INCIDENT_CLASSES).nullable(),
  classifiedAt: z.string().nullable(),
  rootCause: z.string().nullable(),
  prevention: z.string().nullable(),
  rerunOverrideReason: z.string().nullable(),
  campaignId: z.string().exactOptional(),
  rerunGrantId: z.string().nullable().exactOptional(),
  backendProvenance: z
    .looseObject({
      suite: z.enum(PLAYWRIGHT_SUITES),
      target: z.enum(PLAYWRIGHT_TARGETS),
      backendOrigin: z.string(),
      r2Bucket: z.string(),
      storageEndpoint: z.string().nullable(),
    })
    .exactOptional(),
  selectedTestIds: z.array(z.string()).exactOptional(),
  outcomes: z
    .array(
      z.looseObject({
        id: z.string(),
        status: z.enum(['passed', 'failed', 'skipped', 'timedOut', 'interrupted']),
        durationMilliseconds: z.number(),
      }),
    )
    .exactOptional(),
  currentTestId: z.string().nullable().exactOptional(),
  currentTestStartedAt: z.string().nullable().exactOptional(),
  interruptionRecovery: z
    .looseObject({
      recoveredAt: z.string(),
      reason: z.string(),
      durationIsUpperBound: z.literal(true),
      archive: z
        .union([
          z.looseObject({
            attemptedAt: z.string(),
            attemptReason: z.string(),
            status: z.enum(['pending', 'complete']),
          }),
          z.looseObject({
            attemptedAt: z.string(),
            attemptReason: z.string(),
            status: z.literal('failed'),
            error: z.string(),
          }),
        ])
        .exactOptional(),
    })
    .exactOptional(),
  businessDate: z.string().optional(),
  prunedAt: z.string().nullable().exactOptional(),
  auditGroup: z.string().exactOptional(),
  completedAuditGroups: z
    .array(
      z.looseObject({
        group: z.string(),
        runId: z.string(),
        organizationIds: z.array(z.string()),
        cleanedAt: z.string(),
      }),
    )
    .exactOptional(),
});

/** The identities archiveRecoveryActiveState compares in an active world.json. */
const activeWorldIdentitySchema = z.object({
  runId: z.string(),
  orgId: z.string(),
  outsider: z.object({ orgId: z.string() }),
});

function readManifestFile(path: string): RunManifest {
  return runManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

const REPOSITORY_ROOT = resolve(__dirname, '../../..');
const RUN_ARCHIVE_ROOT = resolve(REPOSITORY_ROOT, '.agent-logs/playwright-runs');
function failureMarkerPath(): string {
  return resolve(artifactsDirectory(), 'run-failed.json');
}

function activeManifestPath(runKey = currentRunKey()): string {
  return resolve(artifactsDirectory(runKey), 'run-manifest.json');
}

/** Only old manifests may read the retired shared directory. Current runs never fall back to it. */
function ownedStateDirectory(manifest: RunManifest): string {
  return manifestActiveStateDirectory(REPOSITORY_ROOT, manifest);
}

function readOptionalFile(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() || null : null;
}

function commandOutput(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    // Binary diffs for schema-heavy slices legitimately exceed Node's 1 MiB
    // default. Keep the bound explicit so fingerprinting remains fail-closed.
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function createRunKey(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '').replace('Z', 'Z-');
  return `${timestamp}${randomBytes(3).toString('hex')}`;
}

export function configureRunEnvironment(suite: PlaywrightSuite): void {
  process.env.WERKFLOW_TEST_SUITE = suite;
  process.env.WERKFLOW_TEST_LANE ??= 'direct';
  process.env.WERKFLOW_RUN_KEY ??= createRunKey();
}

export function currentRunKey(): string {
  return configuredRunKey();
}

export function runDirectory(runKey: string): string {
  return browserRunPaths(REPOSITORY_ROOT, runKey).directory;
}

export function manifestPath(runKey: string): string {
  return resolve(runDirectory(runKey), 'manifest.json');
}

function calculateSourceFingerprint(): string {
  const hash = createHash('sha256');
  hash.update(commandOutput('git', ['rev-parse', 'HEAD']));
  hash.update(commandOutput('git', ['diff', '--no-ext-diff', '--binary', 'HEAD']));
  // -z: NUL-separated and unquoted — git C-quotes non-ASCII names in newline
  // mode, and the quoted string is not a readable path (broke the runner on an
  // umlaut-named Playwright artifact, 2026-08-28).
  const untracked = commandOutput('git', ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const relativePath of untracked) {
    hash.update(relativePath);
    hash.update(readFileSync(resolve(REPOSITORY_ROOT, relativePath)));
  }
  return hash.digest('hex');
}

function parseEnvironmentValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  if (!value) return fallback;
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new Error(`${name} must be one of ${allowed.join(', ')}.`);
  }
  return match;
}

export function createRunManifest(input?: {
  command?: string;
  grep?: string | null;
  selectedTestIds?: string[];
  candidateFingerprint?: string;
  groupFingerprint?: string;
}): RunManifest {
  const runKey = currentRunKey();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const suite = parseEnvironmentValue(
    process.env.WERKFLOW_TEST_SUITE,
    PLAYWRIGHT_SUITES,
    'golden',
    'WERKFLOW_TEST_SUITE',
  );
  const manifest: RunManifest = {
    version: 1,
    artifactLayout: 'run-owned-v1',
    groupId: process.env.WERKFLOW_TEST_GROUP,
    groupFingerprint: input?.groupFingerprint,
    runKey,
    // A diagnostic names the failed run it diagnoses, on its retained world or on a fresh one.
    sourceRunKey: process.env.WERKFLOW_REUSE_RUN_KEY || process.env.WERKFLOW_FRESH_FOR_RUN_KEY || null,
    ...(process.env.WERKFLOW_REUSE_RUN_KEY
      ? { diagnosticWorld: 'retained' as const }
      : process.env.WERKFLOW_FRESH_FOR_RUN_KEY
        ? { diagnosticWorld: 'fresh' as const }
        : {}),
    lane: parseEnvironmentValue(
      process.env.WERKFLOW_TEST_LANE,
      PLAYWRIGHT_LANES,
      'direct',
      'WERKFLOW_TEST_LANE',
    ),
    suite,
    target: parseEnvironmentValue(
      process.env.WERKFLOW_TEST_TARGET,
      PLAYWRIGHT_TARGETS,
      defaultTargetForSuite(suite),
      'WERKFLOW_TEST_TARGET',
    ),
    grep: input?.grep ?? (process.env.WERKFLOW_TEST_GREP || null),
    command: input?.command ?? process.env.WERKFLOW_TEST_COMMAND ?? 'direct Playwright invocation',
    status: 'starting',
    startedAt: new Date().toISOString(),
    completedAt: null,
    gitHead: commandOutput('git', ['rev-parse', 'HEAD']),
    sourceFingerprint: calculateSourceFingerprint(),
    candidateFingerprint: input?.candidateFingerprint,
    buildId: readOptionalFile(resolve(REPOSITORY_ROOT, '.next/BUILD_ID')),
    baseUrl: workspaceAppOrigin(REPOSITORY_ROOT),
    projectRef: backendIdentity(supabaseUrl, REPOSITORY_ROOT),
    r2Bucket: process.env.R2_BUCKET_NAME ?? 'missing',
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    world: null,
    retainedAt: null,
    cleanedAt: null,
    classification: null,
    classifiedAt: null,
    rootCause: null,
    prevention: null,
    rerunOverrideReason: null,
    backendProvenance: currentBackendProvenance(suite),
    ...(input?.selectedTestIds !== undefined ? { selectedTestIds: input.selectedTestIds } : {}),
    outcomes: [],
    businessDate: process.env.WERKFLOW_TEST_BUSINESS_DATE,
  };
  mkdirSync(runDirectory(runKey), { recursive: true });
  writeJsonAtomically(manifestPath(runKey), manifest);
  writeJsonAtomically(activeManifestPath(), manifest);
  return manifest;
}

export function ensureRunManifest(): RunManifest {
  const path = manifestPath(currentRunKey());
  if (!existsSync(path)) return createRunManifest();
  return readRunManifest(currentRunKey());
}

export function readRunManifest(runKey: string): RunManifest {
  return readManifestFile(manifestPath(runKey));
}

export function updateRunManifest(
  runKey: string,
  update: Partial<RunManifest> | ((current: RunManifest) => Partial<RunManifest>),
): RunManifest {
  const path = manifestPath(runKey);
  return withFileLock(`${path}.lock`, () => {
    const current = readRunManifest(runKey);
    const patch = typeof update === 'function' ? update(current) : update;
    const next = { ...current, ...patch };
    writeJsonAtomically(path, next);
    if (runKey === process.env.WERKFLOW_RUN_KEY) writeJsonAtomically(activeManifestPath(), next);
    return next;
  });
}

/** Archive-only recovery: never reseed, clean, or replace another run's active state. */
export function recoverInterruptedRun(runKey: string, reason: string): RunManifest {
  assertInterruptedRecoveryOwnership(REPOSITORY_ROOT);
  const manifest = readRunManifest(runKey);
  if (manifest.runKey !== runKey)
    throw new Error('Recovery manifest identity does not match the requested run.');
  const recoveryStateDirectory = ownedStateDirectory(manifest);
  const recoveryManifestPath = resolve(recoveryStateDirectory, 'run-manifest.json');
  let active: RunManifest | null = null;
  let activeIdentityVerified = false;
  return recoverInterruptedEvidence({
    manifest,
    reason,
    persist: (patch) =>
      withFileLock(`${manifestPath(runKey)}.lock`, () => {
        const next = { ...readRunManifest(runKey), ...patch };
        writeJsonAtomically(manifestPath(runKey), next);
        // Do not use an inherited WERKFLOW_RUN_KEY to overwrite another run's active state.
        if (activeIdentityVerified) writeJsonAtomically(recoveryManifestPath, next);
        return next;
      }),
    archiveAndVerify: (recovered) => {
      active = existsSync(recoveryManifestPath) ? readManifestFile(recoveryManifestPath) : null;
      if (recovered.world && !recovered.cleanedAt) {
        if (active?.runKey === runKey) {
          const world = activeWorldIdentitySchema.parse(
            JSON.parse(readFileSync(resolve(recoveryStateDirectory, 'world.json'), 'utf8')),
          );
          archiveRecoveryActiveState(recovered, active, world, () => {
            activeIdentityVerified = true;
            archiveRunOutputs(runKey);
          });
        }
        readRetainedWorldState(recovered, resolve(runDirectory(runKey), 'state/world.json'));
      }
    },
  });
}

export function attachWorldToRun(world: TestWorld): void {
  updateRunManifest(currentRunKey(), {
    world: {
      runId: world.runId,
      organizationIds: [world.orgId, world.outsider.orgId],
      userIds: worldUserIds(world),
    },
  });
}

export function clearActiveRunState(): void {
  mkdirSync(artifactsDirectory(), { recursive: true });
  rmSync(failureMarkerPath(), { force: true });
  rmSync(activeManifestPath(), { force: true });
  rmSync(worldFilePath(), { force: true });
  rmSync(resolve(artifactsDirectory(), 'checkpoints.json'), { force: true });
}

export function markRunFailed(failure: RunFailure): void {
  mkdirSync(artifactsDirectory(), { recursive: true });
  writeJsonAtomically(failureMarkerPath(), failure);
}

export function activeRunFailed(): boolean {
  return existsSync(failureMarkerPath());
}

export function archiveActiveState(runKey = currentRunKey()): void {
  const manifest = readRunManifest(runKey);
  const source = ownedStateDirectory(manifest);
  const activePath = resolve(source, 'run-manifest.json');
  if (existsSync(activePath)) {
    const active = readManifestFile(activePath);
    if (active.runKey !== runKey)
      throw new Error('Active state belongs to another run. Refusing to archive it.');
  } else if (manifest.world && !manifest.cleanedAt) {
    throw new Error('Owned world has no active ownership manifest. Refusing to archive unverified state.');
  }
  if (manifest.world && !manifest.cleanedAt) {
    readRetainedWorldState(manifest, resolve(source, 'world.json'));
  }
  mirrorOwnedStateFiles(
    [resolve(source, 'world.json'), resolve(source, 'checkpoints.json')],
    resolve(runDirectory(runKey), 'state'),
  );
}

export function restoreArchivedState(sourceRunKey: string): TestWorld {
  const sourceManifest = readRunManifest(sourceRunKey);
  const problems = validateDiagnosticProvenance(sourceManifest.backendProvenance, currentBackendProvenance());
  assertRetainedBusinessDate(sourceManifest.businessDate, process.env.WERKFLOW_TEST_BUSINESS_DATE);
  if (problems.length) throw new Error(problems.join('\n'));
  if (!sourceManifest.retainedAt || sourceManifest.cleanedAt) {
    throw new Error(`Run ${sourceRunKey} has no live retained world.`);
  }
  const stateDirectory = resolve(runDirectory(sourceRunKey), 'state');
  // Sessions sign in fresh from the world's users, so world.json is the only required state file.
  const worldSource = resolve(stateDirectory, 'world.json');
  const retainedWorld = readRetainedWorldState(sourceManifest, worldSource);
  assertWorldSeedComplete(retainedWorld);
  clearActiveRunState();
  writeJsonAtomically(activeManifestPath(), readRunManifest(currentRunKey()));
  copyFileSync(worldSource, worldFilePath());
  const checkpoints = resolve(stateDirectory, 'checkpoints.json');
  if (existsSync(checkpoints)) copyFileSync(checkpoints, resolve(artifactsDirectory(), 'checkpoints.json'));
  restoreRetainedWorkloads(runDirectory(sourceRunKey), runDirectory(currentRunKey()));
  return loadWorld();
}

export function currentBackendProvenance(suite?: PlaywrightSuite): BackendProvenance {
  const currentSuite =
    suite ??
    parseEnvironmentValue(
      process.env.WERKFLOW_TEST_SUITE,
      PLAYWRIGHT_SUITES,
      'golden',
      'WERKFLOW_TEST_SUITE',
    );
  return {
    suite: currentSuite,
    target: parseEnvironmentValue(
      process.env.WERKFLOW_TEST_TARGET,
      PLAYWRIGHT_TARGETS,
      defaultTargetForSuite(currentSuite),
      'WERKFLOW_TEST_TARGET',
    ),
    backendOrigin: backendOriginFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    r2Bucket: process.env.R2_BUCKET_NAME ?? 'missing',
    storageEndpoint: process.env.R2_ENDPOINT?.trim() || null,
  };
}

const SUITE_SOURCE_ROOTS: Record<PlaywrightSuite, string> = {
  golden: 'tests/golden',
  audit: 'tests/audit',
  canary: 'tests/canary',
};

export function archiveRunOutputs(runKey = currentRunKey()): void {
  const manifest = readRunManifest(runKey);
  const sourceRoot = SUITE_SOURCE_ROOTS[manifest.suite];
  const target = resolve(runDirectory(runKey), 'playwright');
  mkdirSync(target, { recursive: true });
  for (const directoryName of manifest.artifactLayout === 'run-owned-v1' ? [] : ['.results', '.report']) {
    const source = resolve(REPOSITORY_ROOT, sourceRoot, directoryName);
    if (existsSync(source)) {
      cpSync(source, resolve(target, directoryName.slice(1)), {
        recursive: true,
        force: true,
      });
    }
  }
  archiveActiveState(runKey);
}

/**
 * A concurrent group replaces its manifest by atomic rename while this list is
 * read; a vanished or transiently locked file is skipped, every other error
 * still propagates.
 */
const TRANSIENT_MANIFEST_READ_ERRORS: ReadonlySet<unknown> = new Set(['ENOENT', 'EPERM', 'EBUSY']);

export function listRunManifests(): RunManifest[] {
  if (!existsSync(RUN_ARCHIVE_ROOT)) return [];
  const manifests: RunManifest[] = [];
  for (const entry of readdirSync(RUN_ARCHIVE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      manifests.push(readRunManifest(entry.name));
    } catch (error) {
      if (!TRANSIENT_MANIFEST_READ_ERRORS.has(errorCode(error))) throw error;
    }
  }
  return manifests.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export function markWorldCleaned(world: TestWorld): void {
  const cleanedAt = new Date().toISOString();
  for (const manifest of listRunManifests()) {
    if (manifest.world?.organizationIds.includes(world.orgId) && !manifest.cleanedAt) {
      updateRunManifest(manifest.runKey, { cleanedAt });
    }
  }
}
