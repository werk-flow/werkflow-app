import { expect, type Locator } from "@playwright/test";
import { observeDuringMutation, observeWithoutNavigation, type LiveObservation } from "../../../lib/testing/live-observation";
import { toleratingResponsiveness } from "../../../lib/testing/responsiveness-tolerance";
import { subscribeReceiverNavigation } from "./receiver-navigation";

/** Public Locator evaluation preserves the caller's selector and strictness. */
export function visibleLocatorTimestamp(elements: Element[]): number | false {
  if (elements.length > 1) throw new Error("Measured content has multiple matching elements.");
  const visible = (element: Element): boolean => {
    const style = getComputedStyle(element);
    if (style.visibility !== "visible") return false;
    if (style.display === "contents") {
      return Array.from(element.childNodes).some((child) => {
        if (child instanceof Element) return visible(child);
        if (child.nodeType !== Node.TEXT_NODE) return false;
        const range = document.createRange();
        range.selectNode(child);
        const bounds = range.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      });
    }
    const bounds = element.getBoundingClientRect();
    return element.checkVisibility() && bounds.width > 0 && bounds.height > 0;
  };
  return elements[0] && visible(elements[0]) ? performance.timeOrigin + performance.now() : false;
}

/** Avoid Locator.waitFor's increasing retry delay in a measured appearance check. */
export async function observeLocatorDuringMutation(input: {
  locator: Locator;
  targetMs: number;
  hardTimeoutMs: number;
  mutation: (beforeSubmit: () => Promise<void>) => Promise<void>;
  record: (measurement: LiveObservation) => void;
}): Promise<number> {
  const page = input.locator.page();
  let browserStart = 0;
  let hostStart = 0;
  let browserEnd: number | undefined;
  let startCaptured = false;
  // The engine records and raises every over-target sample; a raise inside the
  // approved tolerance limit resolves here and stays on record as over target.
  return toleratingResponsiveness(input.targetMs, () => observeDuringMutation({
    targetMs: input.targetMs,
    now: () => {
      if (!startCaptured) { startCaptured = true; return browserStart; }
      return browserEnd ?? browserStart + performance.now() - hostStart;
    },
    mutation: (startObservation) => input.mutation(async () => {
      expect(await input.locator.isVisible(), "Measured result must be absent before submission").toBe(false);
      browserStart = await page.evaluate(() => performance.timeOrigin + performance.now());
      hostStart = performance.now();
      startObservation();
    }),
    observe: () => observeWithoutNavigation({
      subscribeNavigation: (onNavigation) => subscribeReceiverNavigation(page, onNavigation),
      observe: async () => {
        // Evaluate immediately and every 16ms thereafter. Transport can delay a
        // sample, but no 500ms selector backoff or later trace work enters it.
        await expect.poll(async () => {
          const timestamp = await input.locator.evaluateAll(visibleLocatorTimestamp);
          if (timestamp === false) return false;
          if (!Number.isFinite(timestamp) || timestamp < browserStart) throw new Error("The browser observation clock is invalid.");
          browserEnd = timestamp;
          return true;
        }, { intervals: [16], timeout: input.hardTimeoutMs }).toBe(true);
        await expect(input.locator).toBeVisible({ timeout: input.hardTimeoutMs });
      },
    }),
    record: input.record,
  }));
}
