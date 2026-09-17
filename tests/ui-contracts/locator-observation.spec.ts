import { expect, test } from "@playwright/test";
import { assertWorkspaceTestLock } from "../../lib/testing/workspace-test-lock";
import type { LiveObservation } from "../../lib/testing/live-observation";
import { observeLocatorDuringMutation, visibleLocatorTimestamp } from "../golden/support/locator-observation";

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  await page.route("http://localhost/locator-observation**", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="de"><body><main><p hidden>Neuer Kunde</p></main></body></html>' }));
  await page.goto("http://localhost/locator-observation");
});

test("locator timing preserves hidden, zero-size and ambiguous selector failures", async ({ page }) => {
  const locator = page.getByRole("main").getByText("Neuer Kunde", { exact: true });
  expect(await locator.evaluateAll(visibleLocatorTimestamp)).toBe(false);
  await page.evaluate(() => document.querySelector("p")?.removeAttribute("hidden"));
  expect(await locator.evaluateAll(visibleLocatorTimestamp)).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector("p")?.setAttribute("style", "display:contents;visibility:hidden"));
  expect(await locator.evaluateAll(visibleLocatorTimestamp)).toBe(false);
  await page.evaluate(() => document.querySelector("p")?.setAttribute("style", "width:0;height:0;overflow:hidden"));
  expect(await locator.evaluateAll(visibleLocatorTimestamp)).toBe(false);
  await page.evaluate(() => { const paragraph = document.querySelector("p"); paragraph?.after(paragraph.cloneNode(true)); });
  await expect(locator.evaluateAll(visibleLocatorTimestamp)).rejects.toThrow("multiple matching elements");
});

test("locator timing ends in the browser while producer confirmation remains pending", async ({ page }) => {
  const records: LiveObservation[] = [];
  const locator = page.getByRole("main").getByText("Neuer Kunde", { exact: true });
  const evaluateAll = locator.evaluateAll.bind(locator);
  let sampledAt: number | undefined;
  let releaseConfirmation!: () => void;
  const confirmation = new Promise<void>((resolve) => { releaseConfirmation = resolve; });
  // Retain the real public Locator/browser evaluation, but hold its return
  // transport until the producer confirms. The timestamp must precede both.
  Object.defineProperty(locator, "evaluateAll", { value: async (evaluate: typeof visibleLocatorTimestamp) => {
    const timestamp = await evaluateAll(evaluate);
    if (timestamp !== false) { sampledAt = timestamp; await confirmation; }
    return timestamp;
  } });
  const beforeMeasurement = await page.evaluate(() => performance.timeOrigin + performance.now());
  let confirmedAt = 0;
  await observeLocatorDuringMutation({
    locator, targetMs: 5000, hardTimeoutMs: 3000, record: (value) => records.push(value),
    mutation: async (start) => {
      try {
        await start();
        await page.evaluate(() => document.querySelector("p")?.removeAttribute("hidden"));
        // A serial observer deadlocks here and fails the bounded assertion.
        await expect.poll(() => sampledAt, { timeout: 1000 }).toBeDefined();
        confirmedAt = await page.evaluate(() => performance.timeOrigin + performance.now());
      } finally { releaseConfirmation(); }
    },
  });
  expect(sampledAt).toBeLessThan(confirmedAt);
  expect(records).toHaveLength(1);
  const [record] = records;
  if (!record) throw new Error("expected one observation record");
  expect(record).toMatchObject({ correctness: "observed", responsiveness: "within_target" });
  expect(beforeMeasurement + record.measuredMs).toBeLessThan(confirmedAt);
});

for (const failure of ["mutation", "navigation", "deadline"] as const) {
  test(`locator timing rejects ${failure} without turning a visible result green`, async ({ page }) => {
    const records: LiveObservation[] = [];
    await expect(observeLocatorDuringMutation({
      locator: page.getByRole("main").getByText("Neuer Kunde", { exact: true }), targetMs: failure === "deadline" ? 0.001 : 5000, hardTimeoutMs: 1000, record: (value) => records.push(value),
      mutation: async (start) => {
        await start();
        if (failure === "navigation") await page.goto("http://localhost/locator-observation?changed=1");
        // The deadline case reveals after the 250 ms tolerance limit of a near-zero target.
        if (failure === "deadline") await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => { document.querySelector("p")?.removeAttribute("hidden"); resolve(); }, 400)));
        else await page.evaluate(() => document.querySelector("p")?.removeAttribute("hidden"));
        if (failure === "mutation") throw new Error("Producer failed");
      },
    })).rejects.toThrow();
    expect(records).toHaveLength(1);
    if (failure === "deadline") expect(records[0]).toMatchObject({ correctness: "observed", responsiveness: "over_target" });
    else expect(records[0]?.responsiveness).toBe("unconfirmed");
  });
}

test("locator timing resolves a result over the target but inside the tolerance limit and records it as over target", async ({ page }) => {
  const records: LiveObservation[] = [];
  const measured = await observeLocatorDuringMutation({
    locator: page.getByRole("main").getByText("Neuer Kunde", { exact: true }), targetMs: 0.001, hardTimeoutMs: 1000, record: (value) => { records.push(value); },
    mutation: async (start) => {
      await start();
      await page.evaluate(() => document.querySelector("p")?.removeAttribute("hidden"));
    },
  });
  expect(measured).toBeLessThanOrEqual(250);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ correctness: "observed", responsiveness: "over_target" });
});
