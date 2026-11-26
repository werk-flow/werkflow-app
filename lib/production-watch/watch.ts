// The production watcher's rules (.github/workflows/prod-watch.yml runs them through
// scripts/prod-watch.ts; docs/technical/recovery-and-incidents.md#monitoring).
//
// It reads metadata only (owner decision 2026-11-07: nothing that reads production reads its data):
//
// - Vercel's production deployments: uid, state, created, meta.githubCommitSha, inspectorUrl, and
//   for a failed one errorCode and errorStep. Never errorMessage, never a build's events.
// - The deployment app.werk-flow.app serves, and the head of the `production` branch.
// - Counts of the metric vercel.request.count with a 5xx status, grouped only by DIMENSIONS. The
//   metric has no message field; a route is a pattern such as /anfragen/[requestId], not a path.
// - Counts of the custom metric werkflow.failure (lib/failure-metric/server.ts), grouped by
//   deploymentId and the metric's own tags, label and code, which never hold a message, an id or a
//   user. The metric has no environment and no route, and staging deploys to the same project, so
//   its query names the production deployments instead (productionFilter).
//
// Rules, each checked every pass from state, so a pass after a gap catches up:
//
// - D1, a failed build: a production deployment in ERROR or CANCELED, BUILD_DEADLINE after its
//   creation, with no READY production deployment of its SHA and none created after it. The
//   deadline covers the release's one redeploy and its 30-minute wait, so a failed release opens
//   "CI alert: release" first.
// - D2, a stuck build: QUEUED, INITIALIZING or BUILDING for longer than BUILD_DEADLINE.
// - D3, production not serving the `production` head for SERVED_GRACE after a pass first saw it.
//   An Instant Rollback matches too: production then runs an older build.
// - S1, a burst: in a 15-minute window, at least BURST_FLOOR server errors and BURST_RATIO times the
//   mean 15-minute count of the 7 days before. The window ends 5 minutes before the pass, so its
//   5-minute buckets are complete.
// - S2, a new failing route: at least ROUTE_FLOOR server errors on one route in 24 hours, and none in
//   the 7 days before.
// - H1 and H2, the same two rules on handled failures, per label and code. A handled failure answers
//   below 500, so S1 and S2 miss it.
//
// One issue per incident. "Production alert: deploy" reports each deployment once and closes when
// production serves the `production` head and no D1 or D2 deployment is open. "Production alert:
// server errors" adds at most one comment per COMMENT_GAP and closes QUIET_AFTER after the newest
// error it reported; "Production alert: handled failures" does the same for H1 and H2. Three failed
// passes in a row open "Production alert: watcher", so a revoked or expired token does not silence
// the watcher. The repository is public: an issue holds ids, states, SHAs, route patterns, labels,
// codes and counts, never a message, and a failure names a call and its status, never a body.

const TEAM = 'team_B8v4QHjpjZWyFXo6wkhiXkgN';
const PROJECT = 'prj_h5ZIXgvJqyy4A7Qqy8Z0j9Ovo86R';
const DOMAIN = 'app.werk-flow.app';

export const DEPLOY = 'Production alert: deploy';
export const ERRORS = 'Production alert: server errors';
export const HANDLED = 'Production alert: handled failures';
export const WATCHER = 'Production alert: watcher';
export type Title = typeof DEPLOY | typeof ERRORS | typeof HANDLED | typeof WATCHER;
export type AlertAction = 'keep' | 'close';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FAILED = new Set(['ERROR', 'CANCELED']);
const BUILDING = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);
const BUILD_DEADLINE = 45 * MINUTE;
const SERVED_GRACE = 60 * MINUTE;
const LOOKBACK = 7 * DAY;
const BUCKET = 5 * MINUTE;
const WINDOW_BUCKETS = 3;
const BURST_FLOOR = 5;
const BURST_RATIO = 4;
const ROUTE_FLOOR = 3;
const COMMENT_GAP = 6 * HOUR;
const QUIET_AFTER = 24 * HOUR;
const FAILURES_TO_ALERT = 3;
const SERIES_LIMIT = 500; // the most groups the metrics API returns
const TABLE_ROWS = 20;
// Dimensions that hold codes, never a raw path, a request, a client or a referrer.
const DIMENSIONS = ['route', 'httpStatus', 'errorCode', 'deploymentId', 'serverActionName'];

/** A failed read or write, named by its call and status only, never by a response body. */
export class WatchError extends Error {}

/** What a pass reads and writes. The live one is in scripts/prod-watch.ts; tests pass a fake. */
export type WatchIo = {
  /** One Vercel API call: a GET, or a POST of `body`. */
  vercel: (path: string, body?: unknown) => Promise<unknown>;
  productionHead: () => Promise<string>;
  /** The titles of the open `ci-alert` issues. */
  openTitles: () => Promise<ReadonlySet<string>>;
  /** Opens or comments on (`keep`), or closes, the alert, as github-actions, assigning the owner. */
  act: (title: Title, action: AlertAction, note: string) => Promise<void>;
};

type CountState = { until?: string; reportedAt?: string; openSeen?: string };

/**
 * What a pass remembers for the next one. Losing it repeats a comment on an open incident, and
 * restarts the SERVED_GRACE wait and the count of failed passes (.github/workflows/prod-watch.yml).
 */
export type WatchState = {
  failures: number;
  watcherReported: boolean;
  reported: string[];
  mismatchSince?: string;
  mismatchReported?: boolean;
  errors: CountState;
  handled: CountState;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const stringField = (value: unknown): string => (typeof value === 'string' ? value : '');
const optionalText = (value: unknown): { value?: string } => (typeof value === 'string' ? { value } : {});

function countState(value: unknown): CountState {
  const record = isRecord(value) ? value : {};
  const state: CountState = {};
  for (const key of ['until', 'reportedAt', 'openSeen'] as const) {
    const field = optionalText(record[key]);
    if (field.value !== undefined) state[key] = field.value;
  }
  return state;
}

/** The state a pass saved, or a fresh one for no file or an unreadable one. */
export function readWatchState(saved: unknown): WatchState {
  const record = isRecord(saved) ? saved : {};
  const state: WatchState = {
    failures: typeof record.failures === 'number' ? record.failures : 0,
    watcherReported: record.watcherReported === true,
    reported: Array.isArray(record.reported) ? record.reported.filter((uid) => typeof uid === 'string') : [],
    errors: countState(record.errors),
    handled: countState(record.handled),
  };
  const since = optionalText(record.mismatchSince);
  if (since.value !== undefined) state.mismatchSince = since.value;
  if (record.mismatchReported === true) state.mismatchReported = true;
  return state;
}

function unexpected(call: string): never {
  throw new WatchError(`Vercel's answer to ${call} has an unexpected shape`);
}
const objectOf = (value: unknown, call: string): Record<string, unknown> =>
  isRecord(value) ? value : unexpected(call);
const listOf = (value: unknown, call: string): readonly unknown[] =>
  Array.isArray(value) ? value : unexpected(call);
const callName = (path: string): string => path.split('?')[0] ?? path;

/** An ISO time to the minute, as the issues and the state hold it. */
const stamp = (moment: number): string => `${new Date(moment).toISOString().slice(0, 16)}Z`;
const parseStamp = (value: string): number => Date.parse(value);
const floorBucket = (moment: number): number => Math.floor(moment / BUCKET) * BUCKET;

type Deployment = { uid: string; state: string; created: number; sha: string; inspector: string };

/** The production deployments created in the lookback, newest first, with the read fields only. */
async function deployments(io: WatchIo, now: number, lookback = LOOKBACK): Promise<Deployment[]> {
  const found: Deployment[] = [];
  let until = '';
  for (;;) {
    const path =
      `/v6/deployments?projectId=${PROJECT}&teamId=${TEAM}&target=production` +
      `&since=${now - lookback}&limit=100${until}`;
    const page = objectOf(await io.vercel(path), callName(path));
    for (const entry of listOf(page.deployments, callName(path))) {
      const item = objectOf(entry, callName(path));
      if (typeof item.uid !== 'string' || typeof item.created !== 'number') unexpected(callName(path));
      const meta = isRecord(item.meta) ? item.meta : {};
      found.push({
        uid: item.uid,
        state: stringField(item.state) || stringField(item.readyState),
        created: item.created,
        sha: stringField(meta.githubCommitSha),
        inspector: stringField(item.inspectorUrl),
      });
    }
    const next = isRecord(page.pagination) ? page.pagination.next : undefined;
    if (typeof next !== 'number' && typeof next !== 'string') return found;
    until = `&until=${next}`;
  }
}

/** errorCode and errorStep of a failed deployment; its errorMessage is free text and stays unread. */
async function failureDetail(io: WatchIo, uid: string): Promise<[string, string]> {
  const item = objectOf(await io.vercel(`/v13/deployments/${uid}?teamId=${TEAM}`), '/v13/deployments');
  return [stringField(item.errorCode), stringField(item.errorStep)];
}

async function servedUid(io: WatchIo): Promise<string> {
  const alias = objectOf(await io.vercel(`/v4/aliases/${DOMAIN}?teamId=${TEAM}`), '/v4/aliases');
  return stringField(alias.deploymentId);
}

/** The deployment the domain serves and its SHA. */
async function served(io: WatchIo, listed: readonly Deployment[]): Promise<[string, string]> {
  const uid = await servedUid(io);
  const match = listed.find((deployment) => deployment.uid === uid);
  if (match) return [uid, match.sha];
  const item = objectOf(await io.vercel(`/v13/deployments/${uid}?teamId=${TEAM}`), '/v13/deployments');
  return [uid, stringField(isRecord(item.meta) ? item.meta.githubCommitSha : undefined)];
}

type DeployFinding = { kind: 'failed' | 'stuck'; deployment: Deployment };

/** Deployments that match D1 or D2, oldest first. */
function deployFindings(listed: readonly Deployment[], now: number): DeployFinding[] {
  const ready = listed.filter((deployment) => deployment.state === 'READY');
  const found: DeployFinding[] = [];
  for (const deployment of listed) {
    if (FAILED.has(deployment.state) && now - deployment.created >= BUILD_DEADLINE) {
      if (!ready.some((r) => r.sha === deployment.sha || r.created > deployment.created))
        found.push({ kind: 'failed', deployment });
    } else if (BUILDING.has(deployment.state) && now - deployment.created > BUILD_DEADLINE) {
      found.push({ kind: 'stuck', deployment });
    }
  }
  return found.sort((a, b) => a.deployment.created - b.deployment.created);
}

/** A count the watcher alerts on: S1 and S2 for server errors, H1 and H2 for handled failures. */
type Signal = {
  title: Title;
  name: string; // in log notes and the closing comment
  heading: string; // the alert's first line
  metric: string;
  aggregation: string;
  filter: string; // empty: the production deployments (productionFilter)
  tags: readonly string[]; // the metric's own dimensions, allowed besides DIMENSIONS
  groups: readonly string[]; // each row of the alert's table
  newness: readonly string[]; // a group of these without a count in the week before is new
  newRule: string;
  state: 'errors' | 'handled';
};

export const SERVER_ERRORS: Signal = {
  title: ERRORS,
  name: 'server-error',
  heading: "Server errors in production, from Vercel's request counts",
  metric: 'vercel.request.count',
  aggregation: 'count',
  filter: 'environment:production AND httpStatus >= 500',
  tags: [],
  groups: ['route', 'httpStatus', 'errorCode', 'deploymentId'],
  newness: ['route'],
  newRule: 'new route',
  state: 'errors',
};
const HANDLED_FAILURES: Signal = {
  title: HANDLED,
  name: 'handled-failure',
  heading: 'Failures the app handled in production, from its werkflow.failure count',
  metric: 'werkflow.failure',
  aggregation: 'sum',
  filter: '',
  tags: ['label', 'code'],
  groups: ['label', 'code', 'deploymentId'],
  newness: ['label', 'code'],
  newRule: 'new failure',
  state: 'handled',
};
const SIGNALS = [SERVER_ERRORS, HANDLED_FAILURES];
const HEADERS: Readonly<Record<string, string>> = {
  route: 'Route',
  httpStatus: 'Status',
  errorCode: 'errorCode',
  deploymentId: 'Deployment',
  label: 'Label',
  code: 'Code',
};

/** The production deployments a count of the last LOOKBACK and QUIET_AFTER can reach, and the one the domain serves. */
async function productionFilter(io: WatchIo, now: number): Promise<string> {
  const listed = await deployments(io, now, LOOKBACK + QUIET_AFTER + 2 * BUCKET);
  const uids = new Set([...listed.map((deployment) => deployment.uid), await servedUid(io)]);
  const named = [...uids].filter((uid) => /^dpl_\w+$/.test(uid)).sort();
  if (named.length === 0) throw new WatchError('no production deployment to count failures of');
  return named.map((uid) => `deploymentId:${uid}`).join(' OR ');
}

type Point = { dimensions: Readonly<Record<string, string>>; count: number };
type SeriesPoint = Point & { at: number };

const isoSeconds = (moment: number): string => `${new Date(moment).toISOString().slice(0, 19)}Z`;

/** Counts of the signal's metric that match `where`: the series per bucket and the summary per group. */
async function counts(
  io: WatchIo,
  signal: Signal,
  where: string,
  [start, end]: [number, number],
  groupBy: readonly string[],
  bucketSeconds: number,
): Promise<{ series: SeriesPoint[]; summary: Point[] }> {
  const allowed = new Set([...DIMENSIONS, ...signal.tags]);
  const refused = groupBy.filter((name) => !allowed.has(name));
  if (refused.length > 0) throw new WatchError(`refusing to group by ${refused.sort().join(', ')}`);
  const call = '/metrics/v1';
  const answer = objectOf(
    await io.vercel(`${call}?teamId=${TEAM}`, {
      scope: { ownerId: TEAM, projectIds: [PROJECT] },
      timeRange: { start: isoSeconds(start), end: isoSeconds(end) },
      bucketSeconds,
      filter: where,
      metrics: { value: { metric: signal.metric, aggregation: signal.aggregation } },
      outputs: ['value'],
      groupBy: [...groupBy],
      seriesSelection: {
        limit: SERIES_LIMIT,
        mode: 'exact',
        rankBy: [{ metric: 'value', direction: 'desc' }],
      },
    }),
    call,
  );
  const point = (entry: unknown): Point & { timestamp: string } => {
    const item = objectOf(entry, call);
    const dimensions: Record<string, string> = {};
    for (const [key, value] of Object.entries(isRecord(item.dimensions) ? item.dimensions : {}))
      if (allowed.has(key)) dimensions[key] = typeof value === 'number' ? String(value) : stringField(value);
    const value = objectOf(item.values, call).value;
    return {
      dimensions,
      count: typeof value === 'number' ? value : 0,
      timestamp: stringField(item.timestamp),
    };
  };
  const series = listOf(answer.series ?? [], call).map((entry) => {
    const { timestamp, ...rest } = point(entry);
    const at = Date.parse(timestamp);
    return Number.isNaN(at) ? unexpected(call) : { ...rest, at };
  });
  const summary = listOf(answer.summary, call).map((entry) => {
    const { dimensions, count } = point(entry);
    return { dimensions, count };
  });
  return { series, summary };
}

type ErrorHit = {
  rule: string; // "burst", or the signal's newRule
  start: number;
  end: number; // the end of the newest bucket that holds its errors
  rows: [string[], number][]; // (the signal's groups..., count)
};

const compareKeys = (a: readonly string[], b: readonly string[]): number => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? '';
    const right = b[index] ?? '';
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
};

/** The signal's burst and new-group hits over the 24 hours before the newest complete bucket. */
async function findings(io: WatchIo, signal: Signal, now: number): Promise<ErrorHit[]> {
  const end = floorBucket(now) - BUCKET;
  const start = end - QUIET_AFTER;
  const where = signal.filter || (await productionFilter(io, now));
  const { series, summary } = await counts(io, signal, where, [start, end], signal.groups, BUCKET / 1000);
  const { summary: before } = await counts(
    io,
    signal,
    where,
    [start - LOOKBACK, start],
    signal.newness,
    3600,
  );
  const baseline = before.reduce((sum, row) => sum + row.count, 0) / (LOOKBACK / (BUCKET * WINDOW_BUCKETS));
  const key = (row: Point) => signal.groups.map((name) => row.dimensions[name] ?? '');
  const newKey = (row: Point) => JSON.stringify(signal.newness.map((name) => row.dimensions[name] ?? ''));
  const hits: ErrorHit[] = [];
  // Each window is WINDOW_BUCKETS consecutive buckets by the clock, so a bucket the answer left
  // out counts as zero.
  for (let last = start + (WINDOW_BUCKETS - 1) * BUCKET; last < end; last += BUCKET) {
    const first = last - (WINDOW_BUCKETS - 1) * BUCKET;
    const rows = new Map<string, [string[], number]>();
    let newest: number | undefined;
    for (const p of series) {
      if (p.at < first || p.at > last || !p.count) continue;
      const id = JSON.stringify(key(p));
      rows.set(id, [key(p), (rows.get(id)?.[1] ?? 0) + p.count]);
      newest = Math.max(newest ?? p.at, p.at);
    }
    const total = [...rows.values()].reduce((sum, [, count]) => sum + count, 0);
    if (newest !== undefined && total >= BURST_FLOOR && total >= BURST_RATIO * baseline)
      // Its end is its newest error, not the window's: a later window over the same errors is no new finding.
      hits.push({
        rule: 'burst',
        start: first,
        end: newest + BUCKET,
        rows: [...rows.values()].sort((a, b) => compareKeys(a[0], b[0])),
      });
  }
  const quiet = new Set(before.filter((row) => row.count).map(newKey));
  const grouped = new Map<string, Point[]>();
  for (const row of summary) grouped.set(newKey(row), [...(grouped.get(newKey(row)) ?? []), row]);
  for (const group of [...grouped.keys()].sort()) {
    const rows = grouped.get(group) ?? [];
    if (quiet.has(group) || rows.reduce((sum, row) => sum + row.count, 0) < ROUTE_FLOOR) continue;
    const times = series.filter((p) => p.count && newKey(p) === group).map((p) => p.at);
    const newest = times.length > 0 ? Math.max(...times) : start;
    const table: [string[], number][] = rows.map((row) => [key(row), row.count]);
    hits.push({
      rule: signal.newRule,
      start,
      end: newest + BUCKET,
      rows: table.sort((a, b) => compareKeys(a[0], b[0])),
    });
  }
  return hits;
}

function deployTable(rows: readonly [DeployFinding, string, string][]): string {
  const lines = [
    '| Deployment | Finding | State | Created | SHA | errorCode | errorStep |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [{ kind, deployment: d }, code, step] of rows) {
    const link = d.inspector.startsWith('https://vercel.com/') ? `[${d.uid}](${d.inspector})` : d.uid;
    lines.push(
      `| ${link} | ${kind} | ${d.state} | ${stamp(d.created)} | \`${d.sha.slice(0, 12)}\` | ${code || '-'} | ${step || '-'} |`,
    );
  }
  return lines.join('\n');
}

function errorTable(signal: Signal, hits: readonly ErrorHit[]): string {
  const columns = signal.groups.map((name) => HEADERS[name] ?? name);
  const lines = [
    `| ${['Rule', 'Window (UTC)', ...columns, 'Count'].join(' | ')} |`,
    `${'| --- '.repeat(columns.length + 3)}|`,
  ];
  const cell = (name: string, value: string) =>
    value && (name === 'route' || name === 'label') ? `\`${value}\`` : value || '-';
  const rows = hits.flatMap((hit) => hit.rows.map((row) => [hit, row] as const));
  for (const [hit, [values, count]] of rows.slice(0, TABLE_ROWS)) {
    const cells = signal.groups.map((name, index) => cell(name, values[index] ?? ''));
    lines.push(
      `| ${hit.rule} | ${stamp(hit.start)} to ${stamp(hit.end)} | ${cells.join(' | ')} | ${count} |`,
    );
  }
  if (rows.length > TABLE_ROWS) lines.push(`\n${rows.length - TABLE_ROWS} more rows left out.`);
  return lines.join('\n');
}

async function watchDeploys(
  io: WatchIo,
  state: WatchState,
  now: number,
  openNow: ReadonlySet<string>,
): Promise<string[]> {
  const listed = await deployments(io, now);
  const reported = new Set(state.reported);
  const fresh = deployFindings(listed, now).filter(({ deployment }) => !reported.has(deployment.uid));
  const rows: [DeployFinding, string, string][] = [];
  for (const finding of fresh)
    rows.push([
      finding,
      ...(finding.kind === 'failed' ? await failureDetail(io, finding.deployment.uid) : (['', ''] as const)),
    ]);
  const [uid, sha] = await served(io, listed);
  const head = await io.productionHead();
  const notes: string[] = [];
  if (sha === head) delete state.mismatchSince;
  else state.mismatchSince ??= stamp(now);
  const since = state.mismatchSince;
  const mismatch = since !== undefined && now - parseStamp(since) >= SERVED_GRACE;
  const text: string[] = [];
  if (rows.length > 0)
    text.push(
      `Production builds failed or stuck for more than ${BUILD_DEADLINE / MINUTE} minutes:\n\n${deployTable(rows)}`,
    );
  if (mismatch && !state.mismatchReported)
    text.push(
      `${DOMAIN} serves ${uid} (\`${sha.slice(0, 12) || 'no SHA'}\`), not the head of \`production\` (\`${head.slice(0, 12)}\`), ` +
        `since ${since}: a rollback or a failed promotion.`,
    );
  if (text.length > 0) {
    await io.act(DEPLOY, 'keep', text.join('\n\n'));
    state.reported = [...new Set([...reported, ...fresh.map(({ deployment }) => deployment.uid)])].sort();
    if (mismatch) state.mismatchReported = true;
    notes.push(`deploy alert: ${rows.length} deployments${mismatch ? ', serving mismatch' : ''}`);
  }
  const openFailures = deployFindings(listed, now);
  if (sha === head) {
    delete state.mismatchReported;
    if (openNow.has(DEPLOY) && openFailures.length === 0) {
      await io.act(
        DEPLOY,
        'close',
        `${DOMAIN} serves the head of \`production\` (${uid}), and no production build is failed or stuck.`,
      );
      notes.push('deploy alert closed');
    }
  }
  // Forget deployments that left the lookback; they cannot match again.
  const inLookback = new Set(listed.map((deployment) => deployment.uid));
  state.reported = state.reported.filter((reportedUid) => inLookback.has(reportedUid));
  return notes;
}

/** One issue per incident of the signal: at most one comment per COMMENT_GAP, closed QUIET_AFTER its newest hit. */
async function watchCounts(
  io: WatchIo,
  signal: Signal,
  state: WatchState,
  now: number,
  openNow: ReadonlySet<string>,
): Promise<string[]> {
  const hits = await findings(io, signal, now);
  const kept = state[signal.state];
  const notes: string[] = [];
  const newest = hits.length > 0 ? Math.max(...hits.map((hit) => hit.end)) : undefined;
  const fresh = newest !== undefined && (kept.until === undefined || stamp(newest) > kept.until);
  const mayComment =
    !openNow.has(signal.title) ||
    kept.reportedAt === undefined ||
    now - parseStamp(kept.reportedAt) >= COMMENT_GAP;
  if (fresh && mayComment) {
    await io.act(signal.title, 'keep', `${signal.heading}:\n\n${errorTable(signal, hits)}`);
    state[signal.state] = { ...kept, until: stamp(newest), reportedAt: stamp(now) };
    notes.push(`${signal.name} alert: ${hits.length} findings`);
  }
  if (openNow.has(signal.title) && newest === undefined) {
    const current = state[signal.state];
    const quietSince = current.until ?? (current.openSeen ??= stamp(now));
    if (now - parseStamp(quietSince) >= QUIET_AFTER) {
      await io.act(signal.title, 'close', `No ${signal.name} finding for ${QUIET_AFTER / HOUR} hours.`);
      state[signal.state] = {};
      notes.push(`${signal.name} alert closed`);
    }
  }
  return notes;
}

/** A failure as the public log may show it: a WatchError's fixed text, else only the error's kind. */
const describe = (error: unknown): string =>
  error instanceof WatchError ? error.message : error instanceof Error ? error.name : 'unknown failure';

/**
 * One production pass. It changes `state` for the next pass and returns its log notes and whether it
 * failed; a failed pass counts toward the watcher alert.
 */
export async function watch(
  io: WatchIo,
  state: WatchState,
  now: number,
): Promise<{ notes: string[]; failed: boolean }> {
  let notes: string[] = [];
  let openNow: ReadonlySet<string> = new Set();
  try {
    openNow = await io.openTitles();
    notes.push(...(await watchDeploys(io, state, now, openNow)));
    for (const signal of SIGNALS) notes.push(...(await watchCounts(io, signal, state, now, openNow)));
  } catch (error) {
    state.failures += 1;
    notes = [`production watcher failed (${state.failures} in a row): ${describe(error)}`];
    if (state.failures >= FAILURES_TO_ALERT && !state.watcherReported) {
      try {
        await io.act(
          WATCHER,
          'keep',
          `The production watcher failed ${state.failures} passes in a row. Last failure: ${describe(error)}. ` +
            'Each failed run of `prod-watch.yml` names the failed call; docs/technical/environments.md, "Credentials", names its token.',
        );
        state.watcherReported = true;
      } catch (alert) {
        notes.push(`watcher alert not written: ${describe(alert)}`);
      }
    }
    return { notes: notes.map((note) => `production: ${note}`), failed: true };
  }
  if (openNow.has(WATCHER)) {
    try {
      await io.act(WATCHER, 'close', 'The production watcher reads Vercel again.');
      notes.push('watcher alert closed');
    } catch (error) {
      state.failures += 1;
      return {
        notes: [...notes, `watcher alert not closed: ${describe(error)}`].map(
          (note) => `production: ${note}`,
        ),
        failed: true,
      };
    }
  }
  state.watcherReported = false;
  state.failures = 0;
  return { notes: notes.map((note) => `production: ${note}`), failed: false };
}
