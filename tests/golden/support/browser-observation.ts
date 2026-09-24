import { expect, type Locator, type Page } from "@playwright/test";
import { MeasurementFailure, ResponsivenessError, observeWithoutNavigation, type LiveObservation } from "../../../lib/testing/live-observation";
import { subscribeReceiverNavigation } from "./receiver-navigation";

/** The measured audit owns these DOM contracts. Ordinary test locators remain unrestricted. */
export type BrowserObservationTarget =
  | { kind: "calendar"; view: "day" | "week" | "month"; rangeStartIso?: string; horizon?: number }
  | { kind: "board-card"; title: string; employeeRecordId: string }
  | { kind: "banner"; text: string }
  | { kind: "list"; name: "kunden" | "auftraege" }
  | { kind: "calendar-event"; title: string; index: number }
  | { kind: "standalone-calendar-visit"; title: string; dateIso: string };

export type MeasuredTarget = { locator: Locator; observation: BrowserObservationTarget };

export function calendarTarget(page: Page, view: "day" | "week" | "month", rangeStartIso?: string, horizon?: number): MeasuredTarget {
  const range = rangeStartIso ? `[data-calendar-range-start="${rangeStartIso}"]` : "";
  const weeks = horizon !== undefined ? `[data-calendar-horizon="${horizon}"]` : "";
  return { locator: page.locator(`[data-calendar-scroll-container][data-calendar-state="ready"][data-calendar-view="${view}"]${range}${weeks}`), observation: { kind: "calendar", view, ...(rangeStartIso !== undefined ? { rangeStartIso } : {}), ...(horizon !== undefined ? { horizon } : {}) } };
}

/** A visit card drawn in one person's row of the Plantafel. */
export function boardCardTarget(page: Page, title: string, employeeRecordId: string): MeasuredTarget {
  if (!title.trim() || !employeeRecordId.trim()) throw new Error("A measured board card needs a title and a row.");
  return { locator: page.locator(`[data-board-row="${employeeRecordId}"] [data-calendar-card]`).filter({ hasText: title }), observation: { kind: "board-card", title, employeeRecordId } };
}

/** The confirmed banner of an optimistic drop. */
export function bannerTarget(page: Page, text: string): MeasuredTarget {
  if (!text.trim()) throw new Error("A measured banner needs its text.");
  return { locator: page.getByRole("alert").filter({ hasText: text }), observation: { kind: "banner", text } };
}

export function listTarget(page: Page, name: "kunden" | "auftraege"): MeasuredTarget {
  return { locator: page.locator(`[data-usable-content-name="${name}"][data-usable-content="ready"]`), observation: { kind: "list", name } };
}

export function calendarEventTarget(page: Page, title: string, index = 0): MeasuredTarget {
  if (!Number.isInteger(index) || index < 0 || !title.trim()) throw new Error("A measured calendar event needs a title and nonnegative index.");
  return { locator: page.locator("[data-calendar-card]").filter({ hasText: title }).nth(index), observation: { kind: "calendar-event", title, index } };
}

/** All job visits in one actual month-grid date cell, including overflowed visits. */
export function calendarDateVisits(page: Page, dateIso: string): Locator {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new Error("A measured calendar date needs an ISO date.");
  return page.locator(`[data-month-day="${dateIso}"] [data-calendar-card]`);
}

/** A newly saved standalone visit cannot match either occurrence of the seeded recurrence. */
export function standaloneCalendarVisitTarget(page: Page, title: string, dateIso: string): MeasuredTarget {
  if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new Error("A measured standalone visit needs a title and ISO date.");
  return {
    locator: calendarDateVisits(page, dateIso).filter({ hasText: title })
      .filter({ hasNot: page.locator('[role="img"][aria-label="Serientermin"]') }),
    observation: { kind: "standalone-calendar-visit", title, dateIso },
  };
}

/** Runs inside Chromium through the public waitForFunction API. Keep this function self-contained. */
export function firstVisibleBrowserTimestamp(target: BrowserObservationTarget): number | false {
  let candidates: Element[];
  if (target.kind === "calendar") {
    candidates = Array.from(document.querySelectorAll('[data-calendar-scroll-container][data-calendar-state="ready"]'))
      .filter((element) => element.getAttribute("data-calendar-view") === target.view && (!target.rangeStartIso || element.getAttribute("data-calendar-range-start") === target.rangeStartIso) && (target.horizon === undefined || element.getAttribute("data-calendar-horizon") === String(target.horizon)));
  } else if (target.kind === "board-card") {
    const normalize = (value: string): string => value.replace(/[\u200b\u00ad]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
    candidates = Array.from(document.querySelectorAll(`[data-board-row="${target.employeeRecordId}"] [data-calendar-card]`))
      .filter((element) => normalize(element.textContent ?? "").includes(normalize(target.title)));
  } else if (target.kind === "banner") {
    candidates = Array.from(document.querySelectorAll('[role="alert"]')).filter((element) => (element.textContent ?? "").includes(target.text));
  } else if (target.kind === "list") {
    candidates = Array.from(document.querySelectorAll('[data-usable-content="ready"]'))
      .filter((element) => element.getAttribute("data-usable-content-name") === target.name);
  } else {
    const normalize = (value: string): string => value.replace(/[\u200b\u00ad]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
    const matching = Array.from(document.querySelectorAll("[data-calendar-card]"))
      .filter((element) => normalize(element.textContent ?? "").includes(normalize(target.title)));
    if (target.kind === "standalone-calendar-visit") {
      candidates = matching.filter((element) => element.closest("[data-month-day]")?.getAttribute("data-month-day") === target.dateIso && !element.querySelector('[role="img"][aria-label="Serientermin"]'));
    } else {
      const selected = matching[target.index];
      candidates = selected ? [selected] : [];
    }
  }
  // Preserve Locator strictness and ordinal selection. A hidden SSR duplicate
  // cannot satisfy the observer or silently change which occurrence is measured.
  if (candidates.length > 1) throw new Error("Measured content has multiple matching elements.");
  const element = candidates[0];
  if (!element) return false;
  const visible = (candidate: Element): boolean => {
    const style = getComputedStyle(candidate);
    if (style.display === "contents") {
      return Array.from(candidate.childNodes).some((child) => {
        if (child instanceof Element) return visible(child);
        if (child.nodeType !== Node.TEXT_NODE) return false;
        const range = document.createRange();
        range.selectNode(child);
        const bounds = range.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      });
    }
    if (!candidate.checkVisibility() || style.visibility !== "visible") return false;
    const bounds = candidate.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  };
  return visible(element) ? performance.timeOrigin + performance.now() : false;
}

/** Browser timestamps end at detection, before Playwright trace snapshots and assertion bookkeeping. */
export async function observeBrowserDuringMutation(input: {
  target: MeasuredTarget;
  targetMs: number;
  hardTimeoutMs: number;
  mutation: (beforeSubmit: () => Promise<void>) => Promise<void>;
  rejectNavigation: boolean;
  record: (measurement: LiveObservation) => void;
}): Promise<number> {
  if (!Number.isFinite(input.targetMs) || input.targetMs <= 0 || !Number.isFinite(input.hardTimeoutMs) || input.hardTimeoutMs <= 0) throw new Error("Browser observation deadlines must be finite and positive.");
  const page = input.target.locator.page();
  let startedAt: number | undefined;
  let hostStartedAt: number | undefined;
  let observation: Promise<{ elapsedMs: number; error?: unknown }> | undefined;
  const beforeSubmit = async (): Promise<void> => {
    if (hostStartedAt !== undefined) throw new Error("A browser measurement must have exactly one submission boundary.");
    expect(await input.target.locator.isVisible(), "Measured result must be absent before the action").toBe(false);
    hostStartedAt = performance.now();
    // Sample before dispatching the real action. The return trip remains in the
    // interval. Absolute browser time also spans a legitimate document navigation.
    startedAt = await page.evaluate(() => performance.timeOrigin + performance.now());
    const start = startedAt;
    const observe = async (): Promise<number> => {
      const timestamp = await page.waitForFunction(firstVisibleBrowserTimestamp, input.target.observation, { polling: "raf", timeout: input.hardTimeoutMs });
      try {
        const end = await timestamp.jsonValue();
        if (typeof end !== "number" || !Number.isFinite(end) || end < start) throw new Error("The browser observation clock is invalid.");
        // An ordinary Locator assertion still owns correctness and rich failure
        // diagnostics, but its polling and trace overhead cannot change the time.
        await expect(input.target.locator).toBeVisible({ timeout: input.hardTimeoutMs });
        return end - start;
      } finally { await timestamp.dispose(); }
    };
    observation = (async () => {
      try {
        let elapsedMs = 0;
        if (input.rejectNavigation) {
          await observeWithoutNavigation({
            subscribeNavigation: (onNavigation) => subscribeReceiverNavigation(page, onNavigation),
            observe: async () => { elapsedMs = await observe(); },
          });
        } else elapsedMs = await observe();
        return { elapsedMs };
      } catch (error) { return { elapsedMs: performance.now() - (hostStartedAt ?? performance.now()), error }; }
    })();
  };
  try { await input.mutation(beforeSubmit); }
  catch (error) {
    if (hostStartedAt === undefined) throw error;
    const measurement: LiveObservation = { status: "mutation_failed", correctness: "unconfirmed", responsiveness: "unconfirmed", targetMs: input.targetMs, measuredMs: performance.now() - hostStartedAt };
    input.record(measurement);
    throw new MeasurementFailure("Measured action failed.", measurement, error);
  }
  if (!observation || startedAt === undefined) throw new Error("Browser measurement never marked its submission boundary.");
  const result = await observation;
  if ("error" in result) {
    const measurement: LiveObservation = { status: "observation_failed", correctness: "not_observed", responsiveness: "unconfirmed", targetMs: input.targetMs, measuredMs: result.elapsedMs };
    input.record(measurement);
    throw new MeasurementFailure("Browser content observation failed.", measurement, result.error);
  }
  const measurement: LiveObservation = { status: "visible", correctness: "observed", responsiveness: result.elapsedMs > input.targetMs ? "over_target" : "within_target", targetMs: input.targetMs, measuredMs: result.elapsedMs };
  input.record(measurement);
  if (measurement.responsiveness === "over_target") throw new ResponsivenessError(measurement);
  return result.elapsedMs;
}
