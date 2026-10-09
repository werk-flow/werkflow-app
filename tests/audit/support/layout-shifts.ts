import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

import { currentRunKey, runDirectory } from '../../golden/support/run-state';

// Layout stability by region and phase (docs/technical/performance.md,
// "Check layout stability"). The browser's layout-shift entries are recorded
// from the first paint; each shift names the region it moved: the page
// header, a usable list, a card by its title, the page body or a landmark.
// The audit marks the moment the page is usable (no skeleton left, main
// thread settled); a shift after that mark without a recent input is a
// defect, because the audited world is quiet and no second session writes.

type RecordedShift = { value: number; startTime: number; hadRecentInput: boolean; regions: string[] };
export type ShiftReport = {
  /** Shift score per region before the page became usable: skeletons that differ from their content. */
  streaming: Record<string, number>;
  /** Every shift after the page became usable that no input caused. */
  afterUsable: { region: string; value: number }[];
};

declare global {
  interface Window {
    __werkflowShifts?: { shifts: RecordedShift[]; usableAt: number | null };
  }
}

function recorderScript(): void {
  if (window.__werkflowShifts) return;
  const state: { shifts: RecordedShift[]; usableAt: number | null } = { shifts: [], usableAt: null };
  window.__werkflowShifts = state;
  const regionOf = (node: Node | null): string => {
    let element: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
    for (; element; element = element.parentElement) {
      if (element.hasAttribute('data-page-header')) return 'page-header';
      const usable = element.getAttribute('data-usable-content-name');
      if (usable) return `list:${usable}`;
      if (element.getAttribute('data-slot') === 'card') {
        const title = element.querySelector('[data-slot="card-title"]')?.textContent?.trim();
        return `card:${(title ?? '').slice(0, 40) || 'untitled'}`;
      }
      if (element.hasAttribute('data-page-body')) return 'page-body';
      const label = element.getAttribute('aria-label');
      if (element.tagName === 'NAV') return `navigation:${label ?? ''}`;
      if (element.tagName === 'ASIDE') return 'sidebar';
      if (element.tagName === 'HEADER') return 'app-header';
      if (element.tagName === 'MAIN') return 'main';
    }
    return 'unnamed';
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: readonly { node: Node | null }[];
        };
        state.shifts.push({
          value: shift.value,
          startTime: shift.startTime,
          hadRecentInput: shift.hadRecentInput,
          regions: [...new Set((shift.sources ?? []).map((source) => regionOf(source.node)))],
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // A browser without the Layout Instability API records nothing.
  }
}

export async function installShiftRecorder(page: Page): Promise<void> {
  await page.addInitScript(recorderScript);
}

/** Marks the page usable: every later shift without an input fails. */
async function markUsable(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__werkflowShifts) window.__werkflowShifts.usableAt = performance.now();
  });
}

/**
 * Watches the usable page for a second of animation frames, then reports the
 * shifts by region and phase.
 */
export async function shiftsAfterUsable(page: Page, route: string): Promise<ShiftReport> {
  await markUsable(page);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 60;
        const next = (): void => {
          frames -= 1;
          if (frames <= 0) done();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
  const report = await readShifts(page);
  // The streaming scores per region, beside the run's evidence, for the skeleton review.
  const directory = runDirectory(currentRunKey());
  mkdirSync(directory, { recursive: true });
  appendFileSync(resolve(directory, 'layout-shifts.ndjson'), `${JSON.stringify({ route, ...report })}\n`);
  return report;
}

async function readShifts(page: Page): Promise<ShiftReport> {
  return page.evaluate(() => {
    const state = window.__werkflowShifts;
    const report: ShiftReport = { streaming: {}, afterUsable: [] };
    if (!state) return report;
    for (const shift of state.shifts) {
      const regions = shift.regions.length ? shift.regions : ['unnamed'];
      if (state.usableAt === null || shift.startTime < state.usableAt) {
        for (const region of regions)
          report.streaming[region] = Number(((report.streaming[region] ?? 0) + shift.value).toFixed(4));
      } else if (!shift.hadRecentInput) {
        for (const region of regions)
          report.afterUsable.push({ region, value: Number(shift.value.toFixed(4)) });
      }
    }
    return report;
  });
}
