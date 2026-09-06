import { mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Locator } from "@playwright/test";
import { currentRunKey, runDirectory } from "./run-state";
import { observeDuringMutation, observeWithoutNavigation } from "../../../lib/testing/live-observation";
import { subscribeReceiverNavigation } from "./receiver-navigation";

import { LIVE_TARGET_MS } from "../../../lib/testing/latency-evidence";
export { LIVE_TARGET_MS, TIME_CORRECTION_READY_MS } from "../../../lib/testing/latency-evidence";
// This timeout bounds diagnosis. It is not the acceptable responsiveness deadline.
export const LIVE_HARD_BUDGET_MS: Record<"local" | "cloud", number> = {
  local: 15_000,
  cloud: 15_000,
};

export async function expectLiveWithin(
  locator: Locator,
  options: {
    label: string;
    mutation: (beforeSubmit: () => Promise<void>) => Promise<void>;
  },
): Promise<number> {
  const backend = process.env.WERKFLOW_TEST_TARGET === "cloud" ? "cloud" : "local";
  const hardBudgetMs = LIVE_HARD_BUDGET_MS[backend];
  const receiver = locator.page();
  return observeDuringMutation({
    targetMs: LIVE_TARGET_MS,
    mutation: (startObservation) => options.mutation(async () => {
      // An old visible value is not evidence that this mutation propagated.
      expect(await locator.isVisible(), `${options.label} must be absent before submission`).toBe(false);
      startObservation();
    }),
    observe: () => observeWithoutNavigation({
      subscribeNavigation: (onNavigation) => subscribeReceiverNavigation(receiver, onNavigation),
      observe: () => expect(locator, `${options.label} must appear live (${backend})`).toBeVisible({
        timeout: hardBudgetMs,
      }),
    }),
    record: (measurement) => {
      const directory = runDirectory(currentRunKey());
      mkdirSync(directory, { recursive: true });
      appendFileSync(resolve(directory, "live-latencies.ndjson"), `${JSON.stringify({
        label: options.label,
        backend,
        ...measurement,
        boundary: "before-submit-to-visible",
        hardBudgetMs,
        overTarget: measurement.responsiveness === "over_target",
        recordedAt: new Date().toISOString(),
      })}\n`);
    },
  });
}


/** Measures the whole action-to-usable interval, including streamed form options. */
export async function expectReadyWithin(
  control: Locator,
  options: { label: string; trigger: () => Promise<void>; targetMs: number },
): Promise<number> {
  const backend = process.env.WERKFLOW_TEST_TARGET === "cloud" ? "cloud" : "local";
  const hardBudgetMs = LIVE_HARD_BUDGET_MS[backend];
  return observeDuringMutation({
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
      appendFileSync(resolve(directory, "readiness-latencies.ndjson"), `${JSON.stringify({
        label: options.label,
        backend,
        ...measurement,
        boundary: "opening-action-to-usable-control",
        hardBudgetMs,
        overTarget: measurement.responsiveness === "over_target",
        recordedAt: new Date().toISOString(),
      })}\n`);
    },
  });
}
