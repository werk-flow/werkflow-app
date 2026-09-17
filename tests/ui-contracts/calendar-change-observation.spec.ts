import { expect, test } from "@playwright/test";
import { assertWorkspaceTestLock } from "../../lib/testing/workspace-test-lock";
import type { LiveObservation } from "../../lib/testing/live-observation";
import { observeCalendarChange } from "../golden/support/calendar-change-observation";

for (const state of ["visible", "absent"] as const) {
  test(`calendar ${state} observation requires the exact DOM result and a ready receiver`, async ({ page }) => {
    assertWorkspaceTestLock();
    await page.setContent('<main><div role="status" aria-label="Kalender bereit">Bereit</div><div role="status" aria-label="Betriebsruhe">Betriebsruhe</div></main>');
    const target = page.getByRole("status", { name: "Betriebsruhe", exact: true, includeHidden: true });
    const ready = page.getByRole("status", { name: "Kalender bereit", exact: true, includeHidden: true });
    if (state === "visible") await target.evaluate((element) => { element.setAttribute("hidden", ""); });
    const measurements: LiveObservation[] = [];
    let submitted = false;
    const result = observeCalendarChange({ target, receiverReady: ready, state,
      mutation: async (beforeSubmit) => {
        await beforeSubmit();
        await ready.evaluate((element) => { element.setAttribute("hidden", ""); });
        if (state === "absent") await target.evaluate((element) => element.remove());
        else await target.evaluate((element) => element.removeAttribute("hidden"));
        submitted = true;
      }, record: (measurement) => measurements.push(measurement),
    });
    await expect.poll(() => submitted).toBe(true);
    expect(measurements).toEqual([]);
    await ready.evaluate((element) => element.removeAttribute("hidden"));
    await result;
    expect(measurements).toEqual([expect.objectContaining({ status: "visible", correctness: "observed", responsiveness: "within_target", targetMs: 2000 })]);
  });
}

test("calendar removal does not treat a merely hidden record as deleted", async ({ page }) => {
  assertWorkspaceTestLock();
  await page.setContent('<main><div role="status" aria-label="Kalender bereit">Bereit</div><div role="status" aria-label="Betriebsruhe">Betriebsruhe</div></main>');
  const target = page.getByRole("status", { name: "Betriebsruhe", exact: true, includeHidden: true });
  const ready = page.getByRole("status", { name: "Kalender bereit", exact: true });
  const measurements: LiveObservation[] = [];
  let submitted = false;
  const result = observeCalendarChange({ target, receiverReady: ready, state: "absent",
    mutation: async (beforeSubmit) => { await beforeSubmit(); await target.evaluate((element) => element.setAttribute("hidden", "")); submitted = true; },
    record: (measurement) => measurements.push(measurement),
  });
  await expect.poll(() => submitted).toBe(true);
  expect(measurements).toEqual([]);
  await target.evaluate((element) => element.remove());
  await result;
  expect(measurements[0]?.correctness).toBe("observed");
});
