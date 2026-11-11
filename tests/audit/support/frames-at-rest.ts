import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';

import { z } from '../../../lib/zod';
import { currentRunKey, runDirectory } from '../../golden/support/run-state';
import { settled } from '../../golden/support/steps/interaction';
import { settleLiveShell } from './performance-steps';

// Frames a page produces while nobody touches it (docs/technical/performance.md,
// "What each instrument proves"). A lab step counts requests, commits and DOM
// mutations, and an animation or a transition causes none of them: the browser
// repaints on its own. Chromium's trace names every frame, so the count sees a
// CSS animation, a script animation, a transition a timer restarts and a
// `requestAnimationFrame` loop alike.

const REST_MS = 3_000;
/**
 * Six frames a second. A running clock redraws its digits once a second in a
 * frame or two; an animation that never ends takes 60 a second or more.
 */
const REST_FRAME_LIMIT = (REST_MS / 1_000) * 6;
/** Per-page diagnosis in the run directory; never compared, never a reference. */
const REST_DIAGNOSIS = 'frames-at-rest.ndjson';
const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
];

const traceSchema = z.object({ traceEvents: z.array(z.object({ name: z.string() })) });

type RestingPage = {
  /** Frames the main thread prepared: style, layout and paint ran, or an animation ticked there. */
  mainFrames: number;
  /** Frames the compositor drew to the screen. */
  drawnFrames: number;
  /** The animations still running after the rest, for the failure message. */
  animations: string[];
};

/** Every running animation as `name on tag.classes`, with `(endless)` when it never ends. */
async function runningAnimations(page: Page, kind: 'all' | 'one-shot'): Promise<string[]> {
  return page.evaluate((wanted) => {
    return document.getAnimations().flatMap((animation) => {
      const endless = animation.effect?.getComputedTiming().iterations === Infinity;
      if (wanted === 'one-shot' && endless) return [];
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      const name =
        animation instanceof CSSAnimation
          ? animation.animationName
          : animation instanceof CSSTransition
            ? `transition of ${animation.transitionProperty}`
            : 'script animation';
      const element = target
        ? `${target.tagName.toLowerCase()}.${target.getAttribute('class') ?? ''}`.slice(0, 80)
        : 'no element';
      return [`${name} on ${element}${endless ? ' (endless)' : ''}`];
    });
  }, kind);
}

/**
 * Lets the settled `page` rest for REST_MS and counts the frames Chromium
 * produced meanwhile. A one-shot transition of the load ends first: it is the
 * end of the navigation, not rest.
 */
async function framesAtRest(browser: Browser, page: Page, label: string): Promise<RestingPage> {
  await settleLiveShell(page);
  await settled(page);
  await expect
    .poll(() => runningAnimations(page, 'one-shot'), { message: `${label}: the transitions of the load end` })
    .toEqual([]);
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  // eslint-disable-next-line test-hygiene/no-wall-clock-wait -- the rest is the measurement: an absence proof counts frames over a window, and no event marks a frame that never comes
  await page.waitForTimeout(REST_MS);
  const trace = traceSchema.parse(JSON.parse((await browser.stopTracing()).toString('utf8')));
  const frames = (name: string): number => trace.traceEvents.filter((event) => event.name === name).length;
  const resting: RestingPage = {
    mainFrames: frames('BeginMainThreadFrame'),
    drawnFrames: frames('DrawFrame'),
    animations: await runningAnimations(page, 'all'),
  };
  const directory = runDirectory(currentRunKey());
  mkdirSync(directory, { recursive: true });
  appendFileSync(resolve(directory, REST_DIAGNOSIS), `${JSON.stringify({ page: label, ...resting })}\n`);
  return resting;
}

/**
 * Fails the test when the settled `page` keeps producing frames at rest. The
 * failure is soft, so a test checks every page and still restores its state.
 */
export async function expectAtRest(browser: Browser, page: Page, label: string): Promise<void> {
  const { mainFrames, drawnFrames, animations } = await framesAtRest(browser, page, label);
  expect
    .soft(
      Math.max(mainFrames, drawnFrames),
      `${label} rests: ${mainFrames} main-thread and ${drawnFrames} drawn frames in ${REST_MS / 1_000} s; running: ${animations.join('; ') || 'nothing at the end of the rest'}`,
    )
    .toBeLessThanOrEqual(REST_FRAME_LIMIT);
}

/**
 * The control: starts an animation that never ends and fails unless both
 * frame counts exceed the limit. A count that misses it would pass every page.
 */
export async function expectEndlessAnimationCounted(browser: Browser, page: Page): Promise<void> {
  await page.evaluate(() => {
    const mark = document.createElement('div');
    mark.style.cssText = 'position:fixed;top:0;left:0;width:8px;height:8px;background:currentColor';
    document.body.append(mark);
    // A layout property the eye can follow: every frame is prepared on the main thread and drawn.
    mark.animate([{ width: '8px' }, { width: '80px' }], { duration: 1_000, iterations: Infinity });
  });
  const { mainFrames, drawnFrames } = await framesAtRest(browser, page, 'control, an endless animation');
  expect(
    Math.min(mainFrames, drawnFrames),
    `The frame count sees an endless animation on both threads (${mainFrames} main-thread, ${drawnFrames} drawn)`,
  ).toBeGreaterThan(REST_FRAME_LIMIT);
}
