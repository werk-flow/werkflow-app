import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  PLAYWRIGHT_LANES,
  PLAYWRIGHT_SUITES,
  PLAYWRIGHT_TARGETS,
  defaultTargetForSuite,
  type IncidentClass,
  type PlaywrightLane,
  type PlaywrightSuite,
  type PlaywrightTarget,
} from "../../../lib/testing/run-policy";
import {
  withFileLock,
  writeJsonAtomically,
} from "../../../lib/testing/file-lock";
import { assertWorldSeedComplete } from "../../../lib/testing/seed-world-plan";
import { backendIdentity } from "../../../lib/testing/proof-environment";
import { browserRunPaths, configuredRunKey, manifestActiveStateDirectory } from "../../../lib/testing/run-paths";
import type { SessionRole } from "./sessions";
import { mirrorOwnedStateFiles, readRetainedWorldState, restoreRetainedWorkloads } from "../../../lib/testing/archive-state";
import { backendOriginFromUrl, validateDiagnosticProvenance, type BackendProvenance, type TestOutcomeEvidence } from "../../../lib/testing/test-evidence";
import { assertRetainedBusinessDate } from '../../../lib/testing/business-date';
import { assertInterruptedRecoveryOwnership, archiveRecoveryActiveState, recoverInterruptedEvidence, type InterruptionRecovery } from '../../../lib/testing/interrupted-run-recovery';
import {
  artifactsDirectory,
  loadWorld,
  storageStatePath,
  type TestWorld,
  worldFilePath,
} from "./world";
import { worldUserIds } from "./seed";

type ArchivedRunStatus =
  | "starting"
  | "running"
  | "passed"
  | "failed"
  | "timedout"
  | "interrupted"
  | "failed_retained"
  | "diagnostic_passed";

export type RunFailure = {
  title: string;
  file: string | null;
  message: string;
  testId?: string;
};

export type RunManifest = {
  version: 1;
  artifactLayout?: "run-owned-v1";
  groupId?: string | undefined;
  groupFingerprint?: string | undefined;
  runKey: string;
  sourceRunKey: string | null;
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
  /** Cleanup-only verification after a local transport change. Original provenance stays immutable. */
  cleanupRelocation?: { verifiedAt: string; reason: string; backend: BackendProvenance };
  selectedTestIds?: string[];
  outcomes?: TestOutcomeEvidence[];
  currentTestId?: string | null;
  currentTestStartedAt?: string | null;
  interruptionRecovery?: InterruptionRecovery;
  businessDate?: string | undefined;
  /** Traces, reports and active state removed by `test:runs prune`; evidence files stay. */
  prunedAt?: string | null;
  auditGroup?: string;
  completedAuditGroups?: Array<{ group: string; runId: string; organizationIds: string[]; cleanedAt: string }>;
};

const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const RUN_ARCHIVE_ROOT = resolve(
  REPOSITORY_ROOT,
  ".agent-logs/playwright-runs",
);
function failureMarkerPath(): string {
  return resolve(artifactsDirectory(), "run-failed.json");
}

function activeManifestPath(runKey = currentRunKey()): string {
  return resolve(artifactsDirectory(runKey), "run-manifest.json");
}

/** Only old manifests may read the retired shared directory. Current runs never fall back to it. */
function ownedStateDirectory(manifest: RunManifest): string {
  return manifestActiveStateDirectory(REPOSITORY_ROOT, manifest);
}
const SESSION_ROLES = [
  "admin",
  "buero",
  "employee",
  "outsider",
] as const satisfies readonly SessionRole[];

function readOptionalFile(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8").trim() || null : null;
}

function commandOutput(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    // Binary diffs for schema-heavy slices legitimately exceed Node's 1 MiB
    // default. Keep the bound explicit so fingerprinting remains fail-closed.
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function createRunKey(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "").replace("Z", "Z-");
  return `${timestamp}${randomBytes(3).toString("hex")}`;
}

export function configureRunEnvironment(suite: PlaywrightSuite): void {
  process.env.WERKFLOW_TEST_SUITE = suite;
  process.env.WERKFLOW_TEST_LANE ??= "direct";
  process.env.WERKFLOW_RUN_KEY ??= createRunKey();
}

export function currentRunKey(): string {
  return configuredRunKey();
}

export function runDirectory(runKey: string): string {
  return browserRunPaths(REPOSITORY_ROOT, runKey).directory;
}

export function manifestPath(runKey: string): string {
  return resolve(runDirectory(runKey), "manifest.json");
}

function calculateSourceFingerprint(): string {
  const hash = createHash("sha256");
  hash.update(commandOutput("git", ["rev-parse", "HEAD"]));
  hash.update(
    commandOutput("git", ["diff", "--no-ext-diff", "--binary", "HEAD"]),
  );
  // -z: NUL-separated and unquoted — git C-quotes non-ASCII names in newline
  // mode, and the quoted string is not a readable path (broke the runner on an
  // umlaut-named Playwright artifact, 2026-08-28).
  const untracked = commandOutput("git", [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const relativePath of untracked) {
    hash.update(relativePath);
    hash.update(readFileSync(resolve(REPOSITORY_ROOT, relativePath)));
  }
  return hash.digest("hex");
}

function parseEnvironmentValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  if (!value) return fallback;
  if (!allowed.includes(value as T)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function createRunManifest(input?: {
  command?: string;
  grep?: string | null;
  selectedTestIds?: string[];
  candidateFingerprint?: string;
  groupFingerprint?: string;
}): RunManifest {
  const runKey = currentRunKey();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const suite = parseEnvironmentValue(
    process.env.WERKFLOW_TEST_SUITE,
    PLAYWRIGHT_SUITES,
    "golden",
    "WERKFLOW_TEST_SUITE",
  );
  const manifest: RunManifest = {
    version: 1,
    artifactLayout: "run-owned-v1",
    groupId: process.env.WERKFLOW_TEST_GROUP,
    groupFingerprint: input?.groupFingerprint,
    runKey,
    sourceRunKey: process.env.WERKFLOW_REUSE_RUN_KEY || null,
    lane: parseEnvironmentValue(
      process.env.WERKFLOW_TEST_LANE,
      PLAYWRIGHT_LANES,
      "direct",
      "WERKFLOW_TEST_LANE",
    ),
    suite,
    target: parseEnvironmentValue(
      process.env.WERKFLOW_TEST_TARGET,
      PLAYWRIGHT_TARGETS,
      defaultTargetForSuite(suite),
      "WERKFLOW_TEST_TARGET",
    ),
    grep: input?.grep ?? (process.env.WERKFLOW_TEST_GREP || null),
    command:
      input?.command ??
      process.env.WERKFLOW_TEST_COMMAND ??
      "direct Playwright invocation",
    status: "starting",
    startedAt: new Date().toISOString(),
    completedAt: null,
    gitHead: commandOutput("git", ["rev-parse", "HEAD"]),
    sourceFingerprint: calculateSourceFingerprint(),
    candidateFingerprint: input?.candidateFingerprint,
    buildId: readOptionalFile(resolve(REPOSITORY_ROOT, ".next/BUILD_ID")),
    baseUrl: process.env.GOLDEN_BASE_URL ?? "http://localhost:3000",
    projectRef: backendIdentity(supabaseUrl, REPOSITORY_ROOT),
    r2Bucket: process.env.R2_BUCKET_NAME ?? "missing",
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
  return JSON.parse(readFileSync(manifestPath(runKey), "utf8")) as RunManifest;
}

export function updateRunManifest(
  runKey: string,
  update:
    Partial<RunManifest> | ((current: RunManifest) => Partial<RunManifest>),
): RunManifest {
  const path = manifestPath(runKey);
  return withFileLock(`${path}.lock`, () => {
    const current = readRunManifest(runKey);
    const patch = typeof update === "function" ? update(current) : update;
    const next = { ...current, ...patch };
    writeJsonAtomically(path, next);
    if (runKey === process.env.WERKFLOW_RUN_KEY)
      writeJsonAtomically(activeManifestPath(), next);
    return next;
  });
}

/** Archive-only recovery: never reseed, clean, or replace another run's active state. */
export function recoverInterruptedRun(runKey: string, reason: string): RunManifest {
  assertInterruptedRecoveryOwnership(REPOSITORY_ROOT);
  const manifest = readRunManifest(runKey);
  if (manifest.runKey !== runKey) throw new Error('Recovery manifest identity does not match the requested run.');
  const recoveryStateDirectory = ownedStateDirectory(manifest);
  const recoveryManifestPath = resolve(recoveryStateDirectory, "run-manifest.json");
  let active: RunManifest | null = null;
  let activeIdentityVerified = false;
  return recoverInterruptedEvidence({
    manifest,
    reason,
    persist: (patch) => withFileLock(`${manifestPath(runKey)}.lock`, () => {
      const next = { ...readRunManifest(runKey), ...patch };
      writeJsonAtomically(manifestPath(runKey), next);
      // Do not use an inherited WERKFLOW_RUN_KEY to overwrite another run's active state.
      if (activeIdentityVerified) writeJsonAtomically(recoveryManifestPath, next);
      return next;
    }),
    archiveAndVerify: (recovered) => {
      active = existsSync(recoveryManifestPath)
        ? JSON.parse(readFileSync(recoveryManifestPath, 'utf8')) as RunManifest : null;
      if (recovered.world && !recovered.cleanedAt) {
        if (active?.runKey === runKey) {
          const world = JSON.parse(readFileSync(resolve(recoveryStateDirectory, "world.json"), 'utf8')) as TestWorld;
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
  rmSync(resolve(artifactsDirectory(), "checkpoints.json"), { force: true });
  for (const role of SESSION_ROLES)
    rmSync(storageStatePath(role), { force: true });
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
  const activePath = resolve(source, "run-manifest.json");
  if (existsSync(activePath)) {
    const active = JSON.parse(readFileSync(activePath, "utf8")) as RunManifest;
    if (active.runKey !== runKey) throw new Error("Active state belongs to another run. Refusing to archive it.");
  } else if (manifest.world && !manifest.cleanedAt) {
    throw new Error("Owned world has no active ownership manifest. Refusing to archive unverified state.");
  }
  if (manifest.world && !manifest.cleanedAt) {
    readRetainedWorldState(manifest, resolve(source, "world.json"));
  }
  mirrorOwnedStateFiles([
    resolve(source, "world.json"),
    resolve(source, "checkpoints.json"),
    ...SESSION_ROLES.map((role) => resolve(source, `${role}.json`)),
  ], resolve(runDirectory(runKey), "state"));
}

export function restoreArchivedState(sourceRunKey: string): TestWorld {
  const sourceManifest = readRunManifest(sourceRunKey);
  const problems = validateDiagnosticProvenance(sourceManifest.backendProvenance, currentBackendProvenance());
  assertRetainedBusinessDate(sourceManifest.businessDate, process.env.WERKFLOW_TEST_BUSINESS_DATE);
  if (problems.length) throw new Error(problems.join("\n"));
  if (!sourceManifest.retainedAt || sourceManifest.cleanedAt) {
    throw new Error(`Run ${sourceRunKey} has no live retained world.`);
  }
  const stateDirectory = resolve(runDirectory(sourceRunKey), "state");
  const retainedWorld = readRetainedWorldState(sourceManifest, resolve(stateDirectory, "world.json"));
  assertWorldSeedComplete(retainedWorld);
  const sources = [
    "world.json",
    ...SESSION_ROLES.map((role) => `${role}.json`),
  ].map((fileName) => {
    const source = resolve(stateDirectory, fileName);
    if (!existsSync(source))
      throw new Error(`Retained run ${sourceRunKey} is missing ${fileName}.`);
    return { source, fileName };
  });
  clearActiveRunState();
  writeJsonAtomically(activeManifestPath(), readRunManifest(currentRunKey()));
  for (const { source, fileName } of sources) {
    copyFileSync(source, resolve(artifactsDirectory(), fileName));
  }
  const checkpoints = resolve(stateDirectory, "checkpoints.json");
  if (existsSync(checkpoints)) copyFileSync(checkpoints, resolve(artifactsDirectory(), "checkpoints.json"));
  restoreRetainedWorkloads(runDirectory(sourceRunKey), runDirectory(currentRunKey()));
  return loadWorld();
}

export function currentBackendProvenance(suite?: PlaywrightSuite): BackendProvenance {
  const currentSuite = suite ?? parseEnvironmentValue(process.env.WERKFLOW_TEST_SUITE, PLAYWRIGHT_SUITES, "golden", "WERKFLOW_TEST_SUITE");
  return {
    suite: currentSuite,
    target: parseEnvironmentValue(process.env.WERKFLOW_TEST_TARGET, PLAYWRIGHT_TARGETS, defaultTargetForSuite(currentSuite), "WERKFLOW_TEST_TARGET"),
    backendOrigin: backendOriginFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    r2Bucket: process.env.R2_BUCKET_NAME ?? "missing",
    storageEndpoint: process.env.R2_ENDPOINT?.trim() || null,
  };
}

const SUITE_SOURCE_ROOTS: Record<PlaywrightSuite, string> = {
  golden: "tests/golden",
  audit: "tests/audit",
  canary: "tests/canary",
};

export function archiveRunOutputs(runKey = currentRunKey()): void {
  const manifest = readRunManifest(runKey);
  const sourceRoot = SUITE_SOURCE_ROOTS[manifest.suite];
  const target = resolve(runDirectory(runKey), "playwright");
  mkdirSync(target, { recursive: true });
  for (const directoryName of manifest.artifactLayout === "run-owned-v1" ? [] : [".results", ".report"]) {
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

export function listRunManifests(): RunManifest[] {
  if (!existsSync(RUN_ARCHIVE_ROOT)) return [];
  return readdirSync(RUN_ARCHIVE_ROOT, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(manifestPath(entry.name)),
    )
    .map((entry) => readRunManifest(entry.name))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export function markWorldCleaned(world: TestWorld): void {
  const cleanedAt = new Date().toISOString();
  for (const manifest of listRunManifests()) {
    if (
      manifest.world?.organizationIds.includes(world.orgId) &&
      !manifest.cleanedAt
    ) {
      updateRunManifest(manifest.runKey, { cleanedAt });
    }
  }
}
