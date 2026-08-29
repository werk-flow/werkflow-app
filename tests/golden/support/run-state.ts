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
import { basename, resolve } from "node:path";

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
import type { SessionRole } from "./sessions";
import {
  ARTIFACTS_DIR,
  loadWorld,
  storageStatePath,
  type TestWorld,
  worldFilePath,
} from "./world";
import { worldUserIds } from "./seed";

export type ArchivedRunStatus =
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
};

export type RunManifest = {
  version: 1;
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
  rerunOverrideReason: string | null;
};

const REPOSITORY_ROOT = resolve(__dirname, "../../..");
export const RUN_ARCHIVE_ROOT = resolve(
  REPOSITORY_ROOT,
  ".agent-logs/playwright-runs",
);
const FAILURE_MARKER_PATH = resolve(ARTIFACTS_DIR, "run-failed.json");
const ACTIVE_MANIFEST_PATH = resolve(ARTIFACTS_DIR, "run-manifest.json");
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
  const runKey = process.env.WERKFLOW_RUN_KEY;
  if (!runKey) throw new Error("WERKFLOW_RUN_KEY was not configured.");
  return runKey;
}

export function runDirectory(runKey: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runKey) || runKey.includes("..")) {
    throw new Error(`Invalid run key: ${runKey}`);
  }
  const directory = resolve(RUN_ARCHIVE_ROOT, runKey);
  if (resolve(directory, "..") !== RUN_ARCHIVE_ROOT) {
    throw new Error(`Invalid run key: ${runKey}`);
  }
  return directory;
}

export function manifestPath(runKey: string): string {
  return resolve(runDirectory(runKey), "manifest.json");
}

export function calculateSourceFingerprint(): string {
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

function projectRefFromUrl(value: string): string {
  try {
    return new URL(value).hostname.split(".")[0] ?? "unknown";
  } catch {
    return "invalid";
  }
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
  rerunOverrideReason?: string | null;
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
    buildId: readOptionalFile(resolve(REPOSITORY_ROOT, ".next/BUILD_ID")),
    baseUrl: process.env.GOLDEN_BASE_URL ?? "http://localhost:3000",
    projectRef: projectRefFromUrl(supabaseUrl),
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
    rerunOverrideReason: input?.rerunOverrideReason ?? null,
  };
  mkdirSync(runDirectory(runKey), { recursive: true });
  writeJsonAtomically(manifestPath(runKey), manifest);
  writeJsonAtomically(ACTIVE_MANIFEST_PATH, manifest);
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
      writeJsonAtomically(ACTIVE_MANIFEST_PATH, next);
    return next;
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
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  rmSync(FAILURE_MARKER_PATH, { force: true });
  rmSync(ACTIVE_MANIFEST_PATH, { force: true });
  rmSync(worldFilePath(), { force: true });
  for (const role of SESSION_ROLES)
    rmSync(storageStatePath(role), { force: true });
}

export function markRunFailed(failure: RunFailure): void {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeJsonAtomically(FAILURE_MARKER_PATH, failure);
}

export function activeRunFailed(): boolean {
  return existsSync(FAILURE_MARKER_PATH);
}

export function archiveActiveState(runKey = currentRunKey()): void {
  const target = resolve(runDirectory(runKey), "state");
  mkdirSync(target, { recursive: true });
  for (const source of [
    worldFilePath(),
    ...SESSION_ROLES.map((role) => storageStatePath(role)),
  ]) {
    if (existsSync(source))
      copyFileSync(source, resolve(target, basename(source)));
  }
}

export function restoreArchivedState(sourceRunKey: string): TestWorld {
  const sourceManifest = readRunManifest(sourceRunKey);
  if (!sourceManifest.retainedAt || sourceManifest.cleanedAt) {
    throw new Error(`Run ${sourceRunKey} has no live retained world.`);
  }
  const stateDirectory = resolve(runDirectory(sourceRunKey), "state");
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
  for (const { source, fileName } of sources) {
    copyFileSync(source, resolve(ARTIFACTS_DIR, fileName));
  }
  return loadWorld();
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
  for (const directoryName of [".results", ".report"]) {
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

export function listRetainedWorlds(): TestWorld[] {
  const worlds = new Map<string, TestWorld>();
  for (const manifest of listRunManifests()) {
    if (!manifest.retainedAt || manifest.cleanedAt) continue;
    const path = resolve(runDirectory(manifest.runKey), "state/world.json");
    if (!existsSync(path)) continue;
    const world = JSON.parse(readFileSync(path, "utf8")) as TestWorld;
    worlds.set(world.orgId, world);
  }
  return [...worlds.values()];
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
