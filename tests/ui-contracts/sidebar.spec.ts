import { expect, test } from "@playwright/test";
import { assertWorkspaceTestLock } from "@/lib/testing/workspace-test-lock";

test("sidebar warms only an intended destination and never reenables automatic prefetch", async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error("Run through bun tests/ui-contracts/run.ts.");
  await page.route("http://localhost/ui-contracts**", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="de"><body><div id="root"></div></body></html>' }));
  await page.goto("http://localhost/ui-contracts");
  await page.evaluate(() => { window.uiContractFixture = "sidebar"; });
  await page.addScriptTag({ path: bundle });
  const customers = page.getByRole("link", { name: "Kunden", exact: true });
  const jobs = page.getByRole("link", { name: "Aufträge", exact: true });
  await expect(customers).toHaveAttribute("data-automatic-prefetch", "false");
  expect(await page.evaluate(() => window.sidebarPrefetches)).toEqual([]);
  await customers.hover();
  expect(await page.evaluate(() => window.sidebarPrefetches)).toEqual(["/kunden"]);
  await jobs.focus();
  expect(await page.evaluate(() => window.sidebarPrefetches)).toEqual(["/kunden", "/auftraege"]);
  await page.getByRole("button", { name: "Ansicht aktualisieren" }).click();
  await expect(page.getByLabel("Aktualisierungen")).toHaveText("1");
  expect(await page.evaluate(() => window.sidebarPrefetches)).toEqual(["/kunden", "/auftraege"]);
  await expect(customers).toHaveAttribute("data-automatic-prefetch", "false");
  await expect(jobs).toHaveAttribute("data-automatic-prefetch", "false");
  await expect(customers).toHaveAttribute("href", "/kunden");
  await expect(jobs).toHaveAttribute("href", "/auftraege");
});
