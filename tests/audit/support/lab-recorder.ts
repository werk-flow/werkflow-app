import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type CDPSession, type Locator, type Page } from '@playwright/test';

import { LAB_ARCHIVE, LAB_MEASUREMENT_VERSION, labObservationSchema } from '../../../lib/testing/lab-record';
import { labMeasurementDigest, labWorkloadDigest } from '../../../lib/testing/lab-count-context';
import { getLabStep, type LabMetric, type LabRole, type LabStep } from '../../../lib/testing/lab-steps';
import { REALTIME_REFRESH_COUNT_ATTRIBUTE } from '../../../lib/ui/route-refresh-signal';
import { requireEnv } from '../../golden/support/env';
import { currentRunKey, readRunManifest, runDirectory } from '../../golden/support/run-state';
import { settled } from '../../golden/support/steps/interaction';
import type { TestWorld } from '../../golden/support/world';
import { installLabProbe, resetLabProbe, type LabProbeCounts } from './lab-probe';
import { trackLabNetwork, type LabNetwork } from './lab-network';
import { createPerformancePage, settleLiveShell } from './performance-steps';

// Records lab steps (docs/technical/performance.md). A step starts on a quiet
// page whose live shell has joined, runs the real user action, waits for the
// usable result, and ends when the page is quiet again: settled, no request
// in flight, and none for QUIET_MS, so the Realtime echo of the step's own
// write lands inside the window. One record per step goes to lab-counts.ndjson
// in the run directory; the runner compares it with the reviewed references.

const REPOSITORY_ROOT = resolve(__dirname, '../../..');
/** Longer than the Realtime debounce plus the observed delivery of the actor's own echo. */
const QUIET_MS = 2_000;
const QUIET_TIMEOUT_MS = 30_000;
const IDLE_FRAMES = 180;
/** Per-step diagnosis in the run directory; never compared, never a reference. */
const LAB_DIAGNOSIS = 'lab-diagnosis.ndjson';

/** Server requests through the local Supabase gateway, read from its access log between two marker requests. */
type BackendLog = {
  mark: (label: string) => Promise<number>;
  requestsBetween: (from: number, to: number) => string[];
  stop: () => void;
};

function followBackendLog(): BackendLog {
  const projectId = readFileSync(resolve(REPOSITORY_ROOT, 'supabase/config.toml'), 'utf8').match(
    /^project_id\s*=\s*"([^"]+)"\s*$/m,
  )?.[1];
  if (!projectId) throw new Error('The lab backend count needs the local Supabase project id.');
  const lines: string[] = [];
  let buffer = '';
  const follower: ChildProcess = spawn(
    'wsl.exe',
    ['-e', 'docker', 'logs', '-f', '--tail', '0', `supabase_kong_${projectId}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const collect = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    lines.push(...parts);
  };
  // The local stack runs in WSL on this workstation; a follower that cannot start fails the step with its cause.
  let failure: Error | null = null;
  follower.on('error', (error) => {
    failure = error;
  });
  follower.stdout?.on('data', collect);
  follower.stderr?.on('data', collect);
  const gateway = new URL(requireEnv('NEXT_PUBLIC_SUPABASE_URL')).origin;
  return {
    mark: async (label) => {
      if (failure) throw new Error(`The gateway log follower could not start: ${failure.message}`);
      const token = `lab_marker=${label}`;
      await expect
        .poll(
          async () => {
            await fetch(`${gateway}/rest/v1/?${token}`).catch(() => null);
            return lines.findIndex((line) => line.includes(token));
          },
          { message: 'The gateway log follower sees the marker request', timeout: 20_000, intervals: [500] },
        )
        .toBeGreaterThanOrEqual(0);
      return lines.findLastIndex((line) => line.includes(token));
    },
    // Method and path only: query strings carry ids and filter values.
    requestsBetween: (from, to) =>
      lines
        .slice(from + 1, to)
        .filter((line) => !line.includes('lab_marker='))
        .map((line) => line.match(/"([A-Z]+) ([^ ?"]+)/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => `${match[1]} ${match[2]}`),
    stop: () => {
      follower.kill();
    },
  };
}

export type LabSession = {
  page: Page;
  role: LabRole;
  viewport: LabStep['viewport'];
  cpuThrottle: LabStep['cpuThrottle'];
  network: LabNetwork;
  cdp: CDPSession;
  backend: BackendLog;
  dispose: () => Promise<void>;
};

/**
 * A warm server and a fresh measured context with the role, viewport and CPU
 * profile of `profileStep`, the probe, the tracker and the CDP session.
 */
export async function openLabSession(input: {
  browser: Browser;
  baseURL: string | undefined;
  world: TestWorld;
  profileStep: string;
}): Promise<LabSession> {
  const step = getLabStep(input.profileStep);
  const { page, dispose } = await createPerformancePage({
    browser: input.browser,
    baseUrl: input.baseURL,
    world: input.world,
    role: step.role,
  });
  await page.setViewportSize(step.viewport);
  await installLabProbe(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: step.cpuThrottle });
  const network = await trackLabNetwork(cdp, new URL(input.baseURL ?? 'http://localhost:3000').origin);
  const backend = followBackendLog();
  return {
    page,
    role: step.role,
    viewport: step.viewport,
    cpuThrottle: step.cpuThrottle,
    network,
    cdp,
    backend,
    dispose: async () => {
      backend.stop();
      await cdp.detach().catch(() => undefined);
      await dispose();
    },
  };
}

async function engineCounts(
  cdp: CDPSession,
): Promise<{ layoutCount: number; recalcStyleCount: number; taskSeconds: number }> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const value = (name: string): number => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    layoutCount: value('LayoutCount'),
    recalcStyleCount: value('RecalcStyleCount'),
    taskSeconds: value('TaskDuration'),
  };
}

async function realtimeRefreshes(page: Page): Promise<number> {
  return Number((await page.locator('html').getAttribute(REALTIME_REFRESH_COUNT_ATTRIBUTE)) ?? '0');
}

/** Settled, nothing in flight, and no request started or finished for QUIET_MS; a loop is a finding. */
async function untilQuiet(session: LabSession): Promise<void> {
  await expect
    .poll(
      async () => {
        await settled(session.page);
        const inFlight = session.network.inFlight();
        if (inFlight.length) return `in flight: ${inFlight.join(', ')}`;
        return session.network.quietForMs() >= QUIET_MS ? 'quiet' : 'recent request';
      },
      { message: 'The page never went quiet', timeout: QUIET_TIMEOUT_MS, intervals: [250] },
    )
    .toBe('quiet');
  await session.page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Lets the page sit for IDLE_FRAMES animation frames, about three seconds: the trigger of an idle step. */
export async function idleFrames(page: Page): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((done) => {
        let left = frames;
        const next = (): void => {
          left -= 1;
          if (left <= 0) done();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    IDLE_FRAMES,
  );
}

function delta(before: number, after: number): number {
  // A cross-process navigation starts the engine counters again.
  return Math.round(after >= before ? after - before : after);
}

function currentBuildId(): string | null {
  try {
    return readRunManifest(currentRunKey()).buildId;
  } catch {
    return null;
  }
}

/**
 * Records one lab step: `trigger` is the real user action, `usable` a
 * client-committed marker of the result. `rows` reads the row count the
 * route shape shows (a list's `data-usable-count`). The test asserts the
 * visible and the persisted result itself; the record is evidence.
 */
export async function recordLabStep(
  session: LabSession,
  stepId: string,
  options: { trigger: () => Promise<unknown>; usable: Locator; rows?: () => Promise<number> },
): Promise<void> {
  const step = getLabStep(stepId);
  if (
    step.role !== session.role ||
    step.cpuThrottle !== session.cpuThrottle ||
    step.viewport.width !== session.viewport.width ||
    step.viewport.height !== session.viewport.height
  )
    throw new Error(`${stepId} is registered for another role, viewport or CPU profile than this session.`);
  const { page, network, cdp, backend } = session;
  if (page.url() !== 'about:blank') {
    await settleLiveShell(page);
    await untilQuiet(session);
  }
  const startMark = await backend.mark(`${stepId}-start-${Date.now()}`);
  const engineBefore = await engineCounts(cdp);
  const echoesBefore = page.url() === 'about:blank' ? 0 : await realtimeRefreshes(page);
  await resetLabProbe(page).catch(() => undefined);
  network.reset();
  let documents = 0;
  const onDocument = (): void => {
    documents += 1;
  };
  page.on('domcontentloaded', onDocument);
  const started = Date.now();
  await options.trigger();
  await expect(options.usable).toBeVisible({ timeout: 30_000 });
  const wallClockMs = Date.now() - started;
  await untilQuiet(session);
  page.off('domcontentloaded', onDocument);
  const engineAfter = await engineCounts(cdp);
  const probe: LabProbeCounts | null = await page.evaluate(() => window.__werkflowLab?.read() ?? null);
  if (!probe) throw new Error('The lab probe is not installed on this document.');
  const traffic = network.read();
  const echoRenders = (await realtimeRefreshes(page)) - (documents ? 0 : echoesBefore);
  const endMark = await backend.mark(`${stepId}-end-${Date.now()}`);
  const backendRequests = backend.requestsBetween(startMark, endMark);
  const rows = options.rows ? await options.rows() : null;
  const counts: Record<LabMetric, number> = {
    requests: traffic.requests,
    routeRenders: traffic.routeRenders - echoRenders,
    echoRenders,
    actionRoundTrips: traffic.actionRoundTrips,
    backgroundReads: traffic.backgroundReads,
    prefetches: traffic.prefetches,
    backendRequests: backendRequests.length,
    reactCommits: probe.reactCommits,
    componentRenders: probe.componentRenders,
    domMutations: probe.domMutations,
    layoutCount: delta(engineBefore.layoutCount, engineAfter.layoutCount),
    recalcStyleCount: delta(engineBefore.recalcStyleCount, engineAfter.recalcStyleCount),
    longTasks: probe.longTasks,
    longAnimationFrames: probe.longAnimationFrames,
  };
  const routeShape = traffic.routeRenderRequests[0];
  const browser = page.context().browser();
  if (!browser) throw new Error('A lab step requires an owned browser context.');
  const directory = runDirectory(currentRunKey());
  const observation = labObservationSchema.parse({
    stepId,
    stepVersion: step.version,
    labMeasurementVersion: LAB_MEASUREMENT_VERSION,
    buildId: currentBuildId(),
    context: {
      measurementDigest: labMeasurementDigest(REPOSITORY_ROOT, step),
      workloadDigest: labWorkloadDigest(REPOSITORY_ROOT, directory),
      browser: browser.browserType().name(),
      browserVersion: browser.version(),
      viewport: session.viewport,
      cpuThrottle: session.cpuThrottle,
      role: session.role,
      backend: process.env.WERKFLOW_TEST_TARGET === 'cloud' ? 'cloud' : 'local',
    },
    counts,
    payloads: traffic.payloads.map((payload) =>
      rows !== null && payload.shape === routeShape ? { ...payload, rows } : payload,
    ),
    wallClockMs,
    recordedAt: new Date().toISOString(),
  });
  mkdirSync(directory, { recursive: true });
  appendFileSync(resolve(directory, LAB_ARCHIVE), `${JSON.stringify(observation)}\n`);
  // Diagnosis beside the evidence: which requests rendered the route and which
  // gateway paths the server read, by method and path only.
  const backendByPath: Record<string, number> = {};
  for (const request of backendRequests) backendByPath[request] = (backendByPath[request] ?? 0) + 1;
  appendFileSync(
    resolve(directory, LAB_DIAGNOSIS),
    `${JSON.stringify({ stepId, routeRenders: traffic.routeRenderRequests, sequence: traffic.sequence, longTaskMs: Math.round(probe.longTaskMs), mainThreadMs: Math.round((engineAfter.taskSeconds - engineBefore.taskSeconds) * 1000), backendByPath })}\n`,
  );
  test.info().annotations.push({
    type: 'lab-step',
    description: `${stepId}: ${wallClockMs} ms, ${counts.routeRenders} route renders, ${counts.requests} requests`,
  });
}
