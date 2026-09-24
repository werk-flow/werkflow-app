import { expect, test } from "@playwright/test";
import { assertWorkspaceTestLock } from "../../lib/testing/workspace-test-lock";
import type { LiveObservation } from "../../lib/testing/live-observation";
import { calendarTarget, calendarEventTarget, firstVisibleBrowserTimestamp, listTarget, observeBrowserDuringMutation, standaloneCalendarVisitTarget } from "../golden/support/browser-observation";

const fixtureUrl = "http://localhost/browser-observation";
const fixture = '<html lang="de"><body><main><div data-usable-content-name="kunden" data-usable-content="loading">Kunden</div></main></body></html>';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  await page.route(`${fixtureUrl}**`, (route) => route.fulfill({ contentType: "text/html", body: fixture }));
  await page.goto(fixtureUrl);
});

test("browser observation rejects hidden streamed content and detects the same visible calendar marker as Locator", async ({ page }) => {
  await page.setContent('<div hidden><div data-calendar-scroll-container data-calendar-state="ready" data-calendar-view="month">Geladen</div></div>');
  const target = calendarTarget(page, "month");
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBe(false);
  await expect(target.locator).toBeHidden();
  await page.evaluate(() => document.querySelector('[hidden]')?.removeAttribute("hidden"));
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBeGreaterThan(0);
  await expect(target.locator).toBeVisible();
  await page.evaluate(() => document.querySelector('[data-calendar-scroll-container]')?.setAttribute("style", "width:0;height:0;overflow:hidden"));
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBe(false);
  await expect(target.locator).toBeHidden();
  await page.evaluate(() => document.querySelector('[data-calendar-scroll-container]')?.removeAttribute("style"));
  await page.evaluate(() => document.querySelector('[data-calendar-scroll-container]')?.setAttribute("data-calendar-state", "loading"));
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBe(false);
  await page.evaluate(() => {
    const marker = document.querySelector('[data-calendar-scroll-container]');
    if (!marker) throw new Error("Calendar fixture marker is missing.");
    marker.setAttribute("data-calendar-state", "ready");
    marker.after(marker.cloneNode(true));
  });
  await expect(target.locator).toHaveCount(2);
  await expect(page.evaluate(firstVisibleBrowserTimestamp, target.observation)).rejects.toThrow("multiple matching elements");
});

test("event observation preserves title matching, occurrence ordinal and zero-size visibility", async ({ page }) => {
  await page.setContent('<a data-calendar-card="month">Messbesuch 1</a><a data-calendar-card="month">Messbesuch 1</a><a data-calendar-card="month" style="display:none">Messbesuch 1</a>');
  const target = calendarEventTarget(page, "Messbesuch 1", 2);
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBe(false);
  await page.evaluate(() => document.querySelector('[style]')?.removeAttribute("style"));
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBeGreaterThan(0);
  await expect(target.locator).toBeVisible();
  expect(await page.evaluate(firstVisibleBrowserTimestamp, calendarEventTarget(page, "Anderer Auftrag").observation)).toBe(false);
});

test("a new standalone visit cannot be substituted by a recurrence or another date after event reordering", async ({ page }) => {
  await page.setContent('<div data-month-day="2026-06-11"><a data-calendar-card="month">Messbesuch 1</a></div><div data-month-day="2026-06-12"><a data-calendar-card="month">Messbesuch 1<svg role="img" aria-label="Serientermin"></svg></a></div>');
  const target = standaloneCalendarVisitTarget(page, "Messbesuch 1", "2026-06-12");
  await expect(target.locator).toHaveCount(0);
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBe(false);
  await page.evaluate(() => {
    const cell = document.querySelector('[data-month-day="2026-06-12"]');
    if (!cell) throw new Error("Calendar fixture date is missing.");
    const added = document.createElement("a");
    added.setAttribute("data-calendar-card", "month");
    added.textContent = "Messbesuch 1";
    added.hidden = true;
    cell.prepend(added);
  });
  await expect(target.locator).toHaveCount(1);
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBe(false);
  await page.evaluate(() => document.querySelector('[hidden]')?.removeAttribute("hidden"));
  expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBeGreaterThan(0);
  await expect(target.locator).toBeVisible();
});

test("a held result stays unobserved until the real DOM predicate becomes ready", async ({ page }) => {
  const records: LiveObservation[] = [];
  const target = listTarget(page, "kunden");
  await observeBrowserDuringMutation({
    target, targetMs: 5000, hardTimeoutMs: 3000, rejectNavigation: true, record: (record) => records.push(record),
    mutation: async (beforeSubmit) => {
      await beforeSubmit();
      expect(await page.evaluate(firstVisibleBrowserTimestamp, target.observation)).toBe(false);
      expect(records).toEqual([]);
      await page.evaluate(() => document.querySelector('[data-usable-content]')?.setAttribute("data-usable-content", "ready"));
    },
  });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ correctness: "observed", responsiveness: "within_target" });
});

test("a failed producer cannot qualify even when its result appeared", async ({ page }) => {
  const records: LiveObservation[] = [];
  await expect(observeBrowserDuringMutation({
    target: listTarget(page, "kunden"), targetMs: 5000, hardTimeoutMs: 1000, rejectNavigation: true, record: (record) => records.push(record),
    mutation: async (beforeSubmit) => {
      await beforeSubmit();
      await page.evaluate(() => document.querySelector('[data-usable-content]')?.setAttribute("data-usable-content", "ready"));
      throw new Error("Acknowledgement failed");
    },
  })).rejects.toThrow("Measured action failed");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ status: "mutation_failed", correctness: "unconfirmed", responsiveness: "unconfirmed" });
});

test("a receiving-page reload invalidates freshness instead of manufacturing visibility", async ({ page }) => {
  const records: LiveObservation[] = [];
  await expect(observeBrowserDuringMutation({
    target: listTarget(page, "kunden"), targetMs: 5000, hardTimeoutMs: 1000, rejectNavigation: true, record: (record) => records.push(record),
    mutation: async (beforeSubmit) => {
      await beforeSubmit();
      await page.reload();
      await page.evaluate(() => document.querySelector('[data-usable-content]')?.setAttribute("data-usable-content", "ready"));
    },
  })).rejects.toThrow("Browser content observation failed");
  expect(records[0]).toMatchObject({ status: "observation_failed", responsiveness: "unconfirmed" });
});

test("legitimate document navigation shares an absolute browser clock without adding post-observation work", async ({ page }) => {
  const records: LiveObservation[] = [];
  let beforeNavigation = 0;
  const elapsed = await observeBrowserDuringMutation({
    target: listTarget(page, "kunden"), targetMs: 5000, hardTimeoutMs: 3000, rejectNavigation: false, record: (record) => records.push(record),
    mutation: async (beforeSubmit) => {
      beforeNavigation = await page.evaluate(() => performance.timeOrigin + performance.now());
      await beforeSubmit();
      await page.goto(`${fixtureUrl}?next`);
      await page.evaluate(() => document.querySelector('[data-usable-content]')?.setAttribute("data-usable-content", "ready"));
      await expect(listTarget(page, "kunden").locator).toBeVisible();
    },
  });
  // The independent rAF observer can detect readiness after the producer's
  // assertion. Sample the upper bound only after that observer has completed.
  const afterNavigation = await page.evaluate(() => performance.timeOrigin + performance.now());
  expect(afterNavigation).toBeGreaterThan(beforeNavigation);
  expect(elapsed).toBeGreaterThanOrEqual(0);
  expect(elapsed).toBeLessThanOrEqual(afterNavigation - beforeNavigation);
  expect(records[0]).toMatchObject({ status: "visible", responsiveness: "within_target" });
});

test("missing content remains a failed observation under the diagnostic timeout", async ({ page }) => {
  const records: LiveObservation[] = [];
  await expect(observeBrowserDuringMutation({
    target: listTarget(page, "kunden"), targetMs: 100, hardTimeoutMs: 150, rejectNavigation: true, record: (record) => records.push(record),
    mutation: (beforeSubmit) => beforeSubmit(),
  })).rejects.toThrow("Browser content observation failed");
  expect(records[0]).toMatchObject({ status: "observation_failed", responsiveness: "unconfirmed" });
});

test("a correct result after the hard deadline remains red with browser timestamps", async ({ page }) => {
  const records: LiveObservation[] = [];
  await expect(observeBrowserDuringMutation({
    target: listTarget(page, "kunden"), targetMs: 1, hardTimeoutMs: 3000, rejectNavigation: true, record: (record) => records.push(record),
    mutation: async (beforeSubmit) => {
      await beforeSubmit();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector('[data-usable-content]')?.setAttribute("data-usable-content", "ready");
        resolve();
      }))));
    },
  })).rejects.toThrow("responsiveness deadline");
  expect(records[0]).toMatchObject({ status: "visible", correctness: "observed", responsiveness: "over_target" });
});
