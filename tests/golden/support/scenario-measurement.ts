// Step 2 measured scenarios. Scenario-keyed measurements write
// scenario-latencies.ndjson. The registry owns boundary, budget, version and
// profile; a record that disagrees with it cannot qualify
// (lib/testing/latency-evidence.ts). This module is the measured path: it is
// in every scenario's measurement digest (lib/testing/performance-context.ts),
// while the ordinary freshness and readiness helpers in live.ts are not, so a
// repair there no longer changes the identity of a reviewed reference
// (pre-Wave-3 step 1, 2026-09-14, after five context-only transfers in Step 3).

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext, Page, Response } from "@playwright/test";
import { getMeasuredScenario, MEASUREMENT_VERSION } from "../../../lib/testing/measured-scenarios";
import { LIVE_HARD_BUDGET_MS, LIVE_TARGET_MS, SCENARIO_ARCHIVE, type ScenarioAttribution, type ScenarioObservation } from "../../../lib/testing/latency-evidence";
import type { LiveObservation } from "../../../lib/testing/live-observation";
import { currentRunKey, readRunManifest, runDirectory } from "./run-state";
import { capturePerformanceContext, type PerformanceContext } from "../../../lib/testing/performance-context";
import { requireEnv } from "./env";
import { observeBrowserDuringMutation, type MeasuredTarget } from "./browser-observation";

/** Each declared navigation sample owns a fresh cache/document context with the same role session. */
export async function createMeasurementPage(authenticatedPage: Page): Promise<{ context: BrowserContext; page: Page }> {
  const browser = authenticatedPage.context().browser();
  if (!browser) throw new Error("Performance sampling needs the owned fixture browser.");
  const context = await browser.newContext({
    storageState: await authenticatedPage.context().storageState(),
    baseURL: new URL(authenticatedPage.url()).origin,
    viewport: authenticatedPage.viewportSize(), locale: "de-DE", timezoneId: "Europe/Berlin",
  });
  try { return { context, page: await context.newPage() }; }
  catch (error) { await context.close(); throw error; }
}

function currentBackend(): "local" | "cloud" {
  return process.env.WERKFLOW_TEST_TARGET === "cloud" ? "cloud" : "local";
}

function currentBuildId(): string | null {
  try {
    return readRunManifest(currentRunKey()).buildId;
  } catch {
    return null;
  }
}

const recordedSamples = new Map<string, number>();

function recordScenario(scenarioId: string, measurement: LiveObservation, context: PerformanceContext, attribution?: ScenarioAttribution): void {
  const scenario = getMeasuredScenario(scenarioId);
  const sample = (recordedSamples.get(scenarioId) ?? 0) + 1;
  recordedSamples.set(scenarioId, sample);
  const record: ScenarioObservation = {
    scenarioId,
    scenarioVersion: scenario.version,
    measurementVersion: MEASUREMENT_VERSION,
    boundary: scenario.boundary,
    budgetMs: scenario.budgetMs,
    profile: scenario.profile,
    backend: currentBackend(),
    buildId: currentBuildId(),
    context,
    sample,
    measuredMs: measurement.measuredMs,
    status: measurement.status,
    correctness: measurement.correctness,
    responsiveness: measurement.responsiveness,
    ...(attribution ? { attribution } : {}),
    recordedAt: new Date().toISOString(),
  };
  const directory = runDirectory(currentRunKey());
  mkdirSync(directory, { recursive: true });
  appendFileSync(resolve(directory, SCENARIO_ARCHIVE), `${JSON.stringify(record)}\n`);
}

type BrowserClockMark = { timeOrigin: number; now: number };

/** A mark that could not be read yields no attribution; a zero origin would count every resource as fresh. */
async function markBrowserClock(page: Page): Promise<BrowserClockMark | null> {
  return page
    .evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now() }))
    .catch(() => null);
}

/**
 * Browser resource attribution since a browser-clock mark; no request bodies
 * or user data. A full navigation replaces the document (new time origin), so
 * every entry of the new document counts and its navigation timing is fresh.
 */
async function readAttribution(page: Page, mark: BrowserClockMark | null, rscUrls: readonly string[]): Promise<ScenarioAttribution | undefined> {
  if (!mark) return undefined;
  try {
    return await page.evaluate(({ timeOrigin, now, rscUrls: confirmedRscUrls }) => {
      const sameDocument = performance.timeOrigin === timeOrigin;
      const since = sameDocument ? now : 0;
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const fresh = !sameDocument && navigation !== undefined;
      const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((entry) => entry.startTime >= since);
      const rsc = resources.filter((entry) => confirmedRscUrls.includes(entry.name));
      const sum = (entries: PerformanceResourceTiming[]): number => entries.reduce((total, entry) => total + (entry.transferSize || entry.encodedBodySize || 0), 0);
      return {
        navigationTtfbMs: fresh && navigation ? Math.round(navigation.responseStart - navigation.startTime) : null,
        navigationResponseEndMs: fresh && navigation ? Math.round(navigation.responseEnd - navigation.startTime) : null,
        requestCount: resources.length,
        transferBytes: sum(resources),
        rscRequestCount: rsc.length,
        rscBytes: sum(rsc),
      };
    }, { ...mark, rscUrls: [...rscUrls] });
  } catch {
    return undefined;
  }
}

async function scenarioContext(page: Page, scenarioId: string): Promise<PerformanceContext> {
  const browser = page.context().browser();
  if (!browser) throw new Error("A measured scenario requires an owned browser context.");
  const browserState = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio }));
  return capturePerformanceContext({
    repositoryRoot: resolve(__dirname, "../../.."),
    evidenceDirectory: runDirectory(currentRunKey()),
    scenario: getMeasuredScenario(scenarioId),
    browser: browser.browserType().name(), browserVersion: browser.version(),
    viewport: page.viewportSize() ?? { width: browserState.width, height: browserState.height },
    deviceScaleFactor: browserState.scale,
    target: currentBackend(),
    providerOrigin: new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL")).origin,
  });
}

/**
 * Navigation, opening, or view switch to usable content. The clock starts
 * before `trigger` (the real user action) and ends when `usable` is visible.
 * `usable` must point at a client-committed marker (`data-calendar-state`,
 * `data-usable-content`) so server HTML before hydration cannot end it.
 */
export async function expectUsableWithin(
  scenarioId: string,
  options: { page: Page; trigger: () => Promise<unknown>; usable: MeasuredTarget },
): Promise<number> {
  const scenario = getMeasuredScenario(scenarioId);
  const usableBoundaries = new Set(["navigation-to-usable-content", "view-switch-to-usable-content", "interaction-to-visible-change", "interaction-to-settled"]);
  if (!usableBoundaries.has(scenario.boundary)) {
    throw new Error(`Scenario ${scenarioId} is not a usable-content or interaction boundary.`);
  }
  const hardBudgetMs = LIVE_HARD_BUDGET_MS[currentBackend()];
  const mark = await markBrowserClock(options.page);
  const context = await scenarioContext(options.page, scenarioId);
  const rscUrls = new Set<string>();
  const onResponse = (response: Response): void => {
    if (response.headers()["content-type"]?.split(";")[0]?.trim() === "text/x-component") rscUrls.add(response.url());
  };
  options.page.on("response", onResponse);
  let measured: LiveObservation | undefined;
  try {
    return await observeBrowserDuringMutation({
      target: options.usable,
      targetMs: scenario.budgetMs,
      hardTimeoutMs: hardBudgetMs,
      rejectNavigation: false,
      mutation: async (startObservation) => {
        await startObservation();
        await options.trigger();
      },
      record: (measurement) => { measured = measurement; },
    });
  } finally {
    options.page.off("response", onResponse);
    // The measured interval has ended. Resource inspection must not add to it.
    if (measured) recordScenario(scenarioId, measured, context, await readAttribution(options.page, mark, [...rscUrls]));
  }
}

/**
 * Cross-session freshness keyed by scenario. Keeps the existing two-second
 * deadline and archive (the group's freshness requirement) and additionally
 * writes the scenario record so the run can be compared against a baseline.
 */
export async function expectScenarioLiveWithin(
  scenarioId: string,
  target: MeasuredTarget,
  options: { mutation: (beforeSubmit: () => Promise<void>) => Promise<void> },
): Promise<number> {
  const scenario = getMeasuredScenario(scenarioId);
  if (scenario.boundary !== "before-submit-to-visible" || scenario.budgetMs !== LIVE_TARGET_MS) {
    throw new Error(`Scenario ${scenarioId} does not use the cross-session freshness contract.`);
  }
  const context = await scenarioContext(target.locator.page(), scenarioId);
  const backend = currentBackend();
  return observeBrowserDuringMutation({
    target, targetMs: scenario.budgetMs, hardTimeoutMs: LIVE_HARD_BUDGET_MS[backend],
    rejectNavigation: true, mutation: options.mutation,
    record: (measurement) => {
      recordScenario(scenarioId, measurement, context);
      appendFileSync(resolve(runDirectory(currentRunKey()), "live-latencies.ndjson"), `${JSON.stringify({
        label: scenarioId, backend, ...measurement, boundary: "before-submit-to-visible",
        hardBudgetMs: LIVE_HARD_BUDGET_MS[backend], overTarget: measurement.responsiveness === "over_target", recordedAt: new Date().toISOString(),
      })}\n`);
    },
  });
}
