import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator } from "@playwright/test";
import { observeCalendarChange } from "../../golden/support/calendar-change-observation";
import { currentRunKey, runDirectory } from "../../golden/support/run-state";

export async function expectCalendarChangeWithin(target: Locator, options: {
  label: string;
  receiverReady: Locator;
  state: "visible" | "absent";
  mutation: (beforeSubmit: () => Promise<void>) => Promise<void>;
}): Promise<number> {
  const backend = process.env.WERKFLOW_TEST_TARGET === "cloud" ? "cloud" : "local";
  return observeCalendarChange({
    target, ...options,
    record: (measurement) => {
      const directory = runDirectory(currentRunKey());
      mkdirSync(directory, { recursive: true });
      appendFileSync(resolve(directory, "live-latencies.ndjson"), `${JSON.stringify({
        label: options.label, backend, ...measurement,
        boundary: options.state === "absent" ? "before-submit-to-absent" : "before-submit-to-visible",
        observationMethod: "direct-dom-wait-and-ready", recordedAt: new Date().toISOString(),
      })}\n`);
    },
  });
}
