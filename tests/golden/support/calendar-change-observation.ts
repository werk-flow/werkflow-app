import { expect, type Locator } from "@playwright/test";
import { observeDuringMutation, observeWithoutNavigation, type LiveObservation } from "../../../lib/testing/live-observation";
import { LIVE_TARGET_MS } from "../../../lib/testing/latency-evidence";
import { subscribeReceiverNavigation } from "./receiver-navigation";

/** Direct DOM waiting avoids count assertions' coarse retry intervals near the freshness deadline. */
export async function observeCalendarChange(input: {
  target: Locator;
  receiverReady: Locator;
  state: "visible" | "absent";
  mutation: (beforeSubmit: () => Promise<void>) => Promise<void>;
  record: (measurement: LiveObservation) => void;
}): Promise<number> {
  if (input.target.page() !== input.receiverReady.page()) throw new Error("Calendar content and readiness must belong to the same receiving page.");
  return observeDuringMutation({
    targetMs: LIVE_TARGET_MS,
    mutation: (start) => input.mutation(async () => {
      await expect(input.receiverReady).toBeVisible();
      if (input.state === "absent") await expect(input.target).toBeVisible();
      else expect(await input.target.isVisible(), "The new calendar result must not already be visible").toBe(false);
      start();
    }),
    observe: () => observeWithoutNavigation({
      subscribeNavigation: (onNavigation) => subscribeReceiverNavigation(input.target.page(), onNavigation),
      observe: async () => {
        // These waits observe DOM mutations directly. The timeout bounds diagnosis,
        // while observeDuringMutation still rejects any result beyond two seconds.
        await input.target.waitFor({ state: input.state === "absent" ? "detached" : "visible", timeout: 15_000 });
        await input.receiverReady.waitFor({ state: "visible", timeout: 15_000 });
        if (input.state === "absent") await expect(input.target).toHaveCount(0);
        else await expect(input.target).toBeVisible();
      },
    }),
    record: input.record,
  });
}
