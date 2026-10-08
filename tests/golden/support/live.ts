import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { currentRunKey, runDirectory } from './run-state';
import { observeDuringMutation } from '../../../lib/testing/live-observation';
import {
  LIVE_HARD_BUDGET_MS,
  LIVE_TARGET_MS,
  completeRecordedObservation,
} from '../../../lib/testing/responsiveness-tolerance';
import { observeLocatorDuringMutation } from './locator-observation';

export { TIME_CORRECTION_READY_MS } from '../../../lib/testing/responsiveness-tolerance';

/** The provider writes this persistent state from its subscription callback. */
export function realtimeSubscribed(page: Page): Locator {
  return page.locator('html[data-realtime-state="subscribed"]');
}

export async function expectLiveWithin(
  locator: Locator,
  options: {
    label: string;
    mutation: (beforeSubmit: () => Promise<void>) => Promise<void>;
    /** The session that submits; its queued Server Actions must drain before the clock starts. */
    actingPage?: Page;
  },
): Promise<number> {
  const backend = process.env.WERKFLOW_TEST_TARGET === 'cloud' ? 'cloud' : 'local';
  const hardBudgetMs = LIVE_HARD_BUDGET_MS[backend];
  // One client's Server Actions run one after another, so a submit that follows
  // a burst of reads waits in that queue before its request leaves (P1-24
  // release, tenth release run 2026-09-14: 2.6 s of the 4.5 s). The freshness
  // clock measures delivery from a quiescent acting session; the queued-reads
  // cost itself is the open enforcement-backlog item.
  if (options.actingPage) await options.actingPage.waitForLoadState('networkidle');
  // The receiving page must be past its database-readiness catch-up before the
  // clock starts: one client's Server Actions run one after another, so an
  // event read that starts during the catch-up read queues behind it (P1-19,
  // fifth release run 2026-09-13, about 800 ms). SUBSCRIBED precedes that read.
  const receivingPage = locator.page();
  await expect(receivingPage.locator('html')).toHaveAttribute('data-realtime-postgres-state', 'ready', {
    timeout: hardBudgetMs,
  });
  await receivingPage.waitForLoadState('networkidle');
  return observeLocatorDuringMutation({
    locator,
    targetMs: LIVE_TARGET_MS,
    hardTimeoutMs: hardBudgetMs,
    mutation: options.mutation,
    record: (measurement) => {
      const directory = runDirectory(currentRunKey());
      mkdirSync(directory, { recursive: true });
      appendFileSync(
        resolve(directory, 'live-latencies.ndjson'),
        `${JSON.stringify({
          label: options.label,
          backend,
          ...measurement,
          boundary: 'before-submit-to-visible',
          hardBudgetMs,
          overTarget: measurement.responsiveness === 'over_target',
          recordedAt: new Date().toISOString(),
        })}\n`,
      );
    },
  });
}

/** Measures the whole action-to-usable interval, including streamed form options. */
export async function expectReadyWithin(
  control: Locator,
  options: {
    label: string;
    trigger: () => Promise<void>;
    targetMs: number;
    boundary?: 'opening-action-to-usable-control' | 'navigation-to-usable-content';
  },
): Promise<number> {
  const backend = process.env.WERKFLOW_TEST_TARGET === 'cloud' ? 'cloud' : 'local';
  const hardBudgetMs = LIVE_HARD_BUDGET_MS[backend];
  return completeRecordedObservation(() =>
    observeDuringMutation({
      targetMs: options.targetMs,
      mutation: async (startObservation) => {
        expect(await control.isVisible(), `${options.label} must be closed before opening`).toBe(false);
        startObservation();
        await options.trigger();
      },
      observe: async () => {
        // Both checks start together. Waiting for the shell never resets the clock.
        await Promise.all([
          expect(control, `${options.label} must be visible`).toBeVisible({ timeout: hardBudgetMs }),
          expect(control, `${options.label} must be enabled`).toBeEnabled({ timeout: hardBudgetMs }),
        ]);
      },
      record: (measurement) => {
        const directory = runDirectory(currentRunKey());
        mkdirSync(directory, { recursive: true });
        appendFileSync(
          resolve(directory, 'readiness-latencies.ndjson'),
          `${JSON.stringify({
            label: options.label,
            backend,
            ...measurement,
            boundary: options.boundary ?? 'opening-action-to-usable-control',
            hardBudgetMs,
            overTarget: measurement.responsiveness === 'over_target',
            recordedAt: new Date().toISOString(),
          })}\n`,
        );
      },
    }),
  );
}

/**
 * Holds a session on the state it reads from now on, as a laptop that woke up
 * without its connection does (testing.md, "Spec checklist": a stale premise
 * is made deterministic). The Realtime socket is swallowed and the catch-up
 * reads on `visibilitychange` and `focus` never start, so another session's
 * change cannot reach this one within milliseconds and dissolve the premise.
 * Call it before the session opens the page whose state must stay old; the
 * returned release lets later navigations of the page receive live updates.
 */
export async function freezeLiveUpdates(page: Page): Promise<() => Promise<void>> {
  await page.routeWebSocket(
    (url) => url.toString().includes('realtime'),
    () => {
      // Swallowed: the page-side socket never reaches Supabase.
    },
  );
  await page.addInitScript(() => {
    // The flag survives navigations of the tab, so the release holds for every later page.
    const frozen = (): boolean => sessionStorage.getItem('werkflow-live-frozen') !== 'false';
    const swallow = (event: Event): void => {
      if (frozen()) event.stopImmediatePropagation();
    };
    document.addEventListener('visibilitychange', swallow, true);
    window.addEventListener('focus', swallow, true);
  });
  return async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.evaluate(() => sessionStorage.setItem('werkflow-live-frozen', 'false'));
  };
}
