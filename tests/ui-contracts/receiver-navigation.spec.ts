import { expect, test } from "@playwright/test";
import { assertWorkspaceTestLock } from "@/lib/testing/workspace-test-lock";
import { subscribeReceiverNavigation } from "../golden/support/receiver-navigation";

test("freshness guard permits same-URL history bookkeeping but rejects a real reload and changed query", async ({ page }) => {
  assertWorkspaceTestLock();
  const url = "http://receiver.test/kunden?sort=name";
  await page.route("http://receiver.test/**", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Receiver</title><p>Ready</p>",
  }));
  await page.goto(url);
  let invalidations = 0;
  const unsubscribe = subscribeReceiverNavigation(page, () => { invalidations += 1; });
  try {
    await Promise.all([
      page.waitForEvent("framenavigated"),
      page.evaluate(() => history.replaceState({}, "", location.href)),
    ]);
    expect(invalidations).toBe(0);

    await page.reload();
    expect(page.url()).toBe(url);
    expect(invalidations).toBe(1);

    await Promise.all([
      page.waitForEvent("framenavigated"),
      page.evaluate(() => history.replaceState({}, "", "?sort=created")),
    ]);
    expect(invalidations).toBe(2);
  } finally {
    unsubscribe();
  }
  await page.reload();
  expect(invalidations).toBe(2);
});
