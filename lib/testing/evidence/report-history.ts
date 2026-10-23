/**
 * The planner's view of the verification archive: every report, in start order, with its group
 * results and input snapshot. Until 2026-10-23 `bun run test:plan` parsed every report.json in
 * full, 1.2 GB for 600 reports, because each reused result carried its report's whole snapshot and
 * the measurement and lab tables came along. A cache beside the archive now holds what the plan
 * reads, with each distinct snapshot stored once as indexes into one table of (file, digest) pairs.
 * A report enters the cache again whenever its report.json size or modification time changes, and a
 * cache that does not parse is rebuilt from the reports. The cache only saves reading: every
 * selection and reuse rule runs on the same reports as before. It is no evidence; the publication
 * gate reads report.json through the evidence ledger.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomically } from '../runner/file-lock';
import { groupResultSchema, inputSnapshotSchema, type InputSnapshot } from './group-evidence';

/** What the plan reads of a report besides its snapshot. */
const historyReportSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  mode: z.enum(['change', 'release']),
  target: z.enum(['local', 'cloud']),
  status: z.enum(['running', 'passed', 'failed']),
  scope: z.enum(['selected-groups', 'all-required-groups']),
  selected: z.array(z.string()),
  results: z.array(groupResultSchema),
});
export type HistoryReport = z.infer<typeof historyReportSchema> & { snapshot: InputSnapshot };

const CACHE_VERSION = 1;
const DIGEST = /^[a-f0-9]{64}$/;
const cacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  /** Every distinct (file, digest) pair of the cached snapshots. */
  pairs: z.array(z.tuple([z.string(), z.string().regex(DIGEST)])),
  /** Every distinct snapshot: its environment and its pairs as comma-joined indexes. */
  snapshots: z.array(z.object({ environment: z.string().regex(DIGEST), pairs: z.string() })),
  reports: z.array(
    z.object({
      directory: z.string(),
      size: z.number(),
      mtimeMs: z.number(),
      snapshot: z.number().int().nonnegative(),
      report: historyReportSchema,
    }),
  ),
});
type Cache = z.infer<typeof cacheSchema>;
type Entry = { directory: string; size: number; mtimeMs: number; report: HistoryReport };

/** The snapshots a cache holds; undefined when an index points outside its pair table. */
function cachedSnapshots(cache: Cache): InputSnapshot[] | undefined {
  const snapshots: InputSnapshot[] = [];
  for (const stored of cache.snapshots) {
    const files: Record<string, string> = {};
    for (const index of stored.pairs ? stored.pairs.split(',') : []) {
      const pair = cache.pairs[Number(index)];
      if (!pair) return undefined;
      files[pair[0]] = pair[1];
    }
    snapshots.push({ version: 1, files, environment: stored.environment });
  }
  return snapshots;
}

/** The cached entries by directory; empty for a missing, outdated or damaged cache. */
function readCache(path: string): Map<string, Entry> {
  if (!existsSync(path)) return new Map();
  let parsed: Cache;
  try {
    parsed = cacheSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    // A cache from another version or a torn write is rebuilt from the reports themselves.
    return new Map();
  }
  const snapshots = cachedSnapshots(parsed);
  const entries = new Map<string, Entry>();
  for (const { snapshot: index, report, ...key } of parsed.reports) {
    const snapshot = snapshots?.[index];
    if (!snapshot) return new Map();
    entries.set(key.directory, { ...key, report: { ...report, snapshot } });
  }
  return entries;
}

function writeCache(path: string, entries: readonly Entry[]): void {
  const pairIndexes = new Map<string, number>();
  const pairs: [string, string][] = [];
  const snapshotIndexes = new Map<InputSnapshot, number>();
  const snapshotsByKey = new Map<string, number>();
  const snapshots: Cache['snapshots'] = [];
  const snapshotIndex = (snapshot: InputSnapshot): number => {
    const known = snapshotIndexes.get(snapshot);
    if (known !== undefined) return known;
    const indexes = Object.entries(snapshot.files).map(([file, digest]) => {
      const key = `${file}\0${digest}`;
      const existing = pairIndexes.get(key);
      if (existing !== undefined) return existing;
      pairs.push([file, digest]);
      pairIndexes.set(key, pairs.length - 1);
      return pairs.length - 1;
    });
    const stored = { environment: snapshot.environment, pairs: indexes.join(',') };
    const key = `${stored.environment}:${stored.pairs}`;
    const index = snapshotsByKey.get(key) ?? snapshots.push(stored) - 1;
    snapshotsByKey.set(key, index);
    snapshotIndexes.set(snapshot, index);
    return index;
  };
  const reports = entries.map(({ report: { snapshot, ...report }, ...key }) => ({
    ...key,
    snapshot: snapshotIndex(snapshot),
    report,
  }));
  writeJsonAtomically(path, { version: CACHE_VERSION, pairs, snapshots, reports } satisfies Cache);
}

function readReport(file: string): HistoryReport {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const snapshot = inputSnapshotSchema.parse(z.object({ snapshot: z.unknown() }).parse(raw).snapshot);
  return { ...historyReportSchema.parse(raw), snapshot };
}

/** Every report of the archive in directory (start) order, read through the cache at `cachePath`. */
export function readReportHistory(archive: string, cachePath: string): HistoryReport[] {
  if (!existsSync(archive)) return [];
  const cached = readCache(cachePath);
  let changed = false;
  const entries = readdirSync(archive)
    .sort()
    .flatMap((directory): Entry[] => {
      const file = resolve(archive, directory, 'report.json');
      if (!existsSync(file)) return [];
      const { size, mtimeMs } = statSync(file);
      const entry = cached.get(directory);
      if (entry && entry.size === size && entry.mtimeMs === mtimeMs) return [entry];
      changed = true;
      return [{ directory, size, mtimeMs, report: readReport(file) }];
    });
  if (changed || entries.length !== cached.size) writeCache(cachePath, entries);
  return entries.map((entry) => entry.report);
}
