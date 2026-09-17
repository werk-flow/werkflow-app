import { expect, test, type Page } from "@playwright/test";
import { assertWorkspaceTestLock } from "@/lib/testing/workspace-test-lock";

async function readCount(page: Page, count: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.calendarContract.reads.length)).toBe(count);
}
async function resolveRead(page: Page, index: number, label: string, success = true): Promise<void> {
  await page.evaluate(({ index, label, success }) => window.calendarContract.resolveRead(index, label, success), { index, label, success });
}
test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error("Run through bun tests/ui-contracts/run.ts.");
  await page.clock.install({ time: new Date("2026-09-08T10:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-08T10:00:01Z"));
  const url = "http://localhost/ui-contracts";
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: '<html lang="de"><body><div id="root"></div></body></html>' }));
  await page.goto(url);
  await page.evaluate(() => { window.uiContractFixture = "calendar"; });
  await page.addScriptTag({ path: bundle });
  await readCount(page, 1);
});

test("ordinary events share one feature debounce across tables", async ({ page }) => {
  await resolveRead(page, 0, "vorher");
  await expect(page.getByLabel("Daten")).toHaveText("vorher");
  await page.evaluate(() => {
    window.calendarContract.emit("jobs");
    window.calendarContract.emit("jobs");
    window.calendarContract.emit("planning_occurrences");
  });
  await page.clock.runFor(149);
  await readCount(page, 1);
  await page.clock.runFor(2);
  await readCount(page, 2);
  await resolveRead(page, 1, "aktuell");
  await expect(page.getByLabel("Daten")).toHaveText("aktuell");
  await page.clock.runFor(1_000);
  await readCount(page, 2);
});

test("reconnect recovers a write made after an earlier read inside the disconnected gap", async ({ page }) => {
  await resolveRead(page, 0, "vorher");
  await expect(page.getByLabel("Daten")).toHaveText("vorher");
  await page.evaluate(() => window.calendarContract.status("CHANNEL_ERROR"));
  await page.getByRole("button", { name: "Aktualisieren" }).click();
  await readCount(page, 2);
  await resolveRead(page, 1, "während der Lücke");
  await expect(page.getByLabel("Daten")).toHaveText("während der Lücke");
  // The server changes after that snapshot; no event is delivered in the gap.
  await page.evaluate(() => window.calendarContract.status("SUBSCRIBED"));
  await page.evaluate(() => window.calendarContract.system({ extension: 'postgres_changes', status: 'ok' }));
  await page.clock.runFor(151);
  await readCount(page, 3);
  await resolveRead(page, 2, "nach der Lücke");
  await expect(page.getByLabel("Daten")).toHaveText("nach der Lücke");
});

test("reconnect does not treat a failed read as coverage of missed updates", async ({ page }) => {
  await resolveRead(page, 0, "", false);
  await expect(page.getByLabel("Fehler", { exact: true })).toHaveText("1");
  await page.evaluate(() => window.calendarContract.status("CHANNEL_ERROR"));
  await page.getByRole("button", { name: "Aktualisieren" }).click();
  await readCount(page, 2);
  await resolveRead(page, 1, "", false);
  await expect(page.getByLabel("Fehler", { exact: true })).toHaveText("2");
  await page.evaluate(() => window.calendarContract.status("SUBSCRIBED"));
  await page.evaluate(() => window.calendarContract.system({ extension: 'postgres_changes', status: 'ok' }));
  await page.clock.runFor(151);
  await readCount(page, 3);
  await resolveRead(page, 2, "wiederhergestellt");
  await expect(page.getByLabel("Daten")).toHaveText("wiederhergestellt");
});

test("a reconnect supersedes a held read that started before the channel recovered", async ({ page }) => {
  await page.evaluate(() => window.calendarContract.status("CHANNEL_ERROR"));
  await page.evaluate(() => window.calendarContract.status("SUBSCRIBED"));
  await page.evaluate(() => window.calendarContract.system({ extension: 'postgres_changes', status: 'ok' }));
  await page.clock.runFor(151);
  await readCount(page, 2);
  await resolveRead(page, 1, "nach Wiederverbindung");
  await resolveRead(page, 0, "vor Wiederverbindung");
  await expect(page.getByLabel("Daten")).toHaveText("nach Wiederverbindung");
});

// Decision D5: a focus or visibility return re-reads only after a real absence.
async function goAway(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
}
async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

test('a short absence triggers no catch-up, a long one exactly one, and a reconnect still catches up at once', async ({ page }) => {
  await resolveRead(page, 0, 'vorher');
  await page.evaluate(() => window.calendarContract.status('SUBSCRIBED'));
  await page.evaluate(() => window.calendarContract.system({ extension: 'postgres_changes', status: 'ok' }));
  await page.clock.runFor(151);
  await readCount(page, 2);
  await resolveRead(page, 1, 'bereit');

  await goAway(page);
  await page.clock.runFor(5_000);
  await comeBack(page);
  await page.clock.runFor(1_200);
  await readCount(page, 2);

  // A focus event without a preceding absence is not a return either.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(1_200);
  await readCount(page, 2);

  await goAway(page);
  await page.clock.runFor(40_000);
  await comeBack(page);
  await page.clock.runFor(151);
  await readCount(page, 3);
  await resolveRead(page, 2, 'nach Rückkehr');
  await expect(page.getByLabel('Daten')).toHaveText('nach Rückkehr');

  // The reconnect catch-up does not wait for any absence.
  await page.evaluate(() => window.calendarContract.status('CHANNEL_ERROR'));
  await page.evaluate(() => window.calendarContract.status('SUBSCRIBED'));
  await page.evaluate(() => window.calendarContract.system({ extension: 'postgres_changes', status: 'ok' }));
  await page.clock.runFor(151);
  await readCount(page, 4);
});

test('database readiness recovers changes after channel join for route and calendar readers', async ({ page }) => {
  await resolveRead(page, 0, 'vorher');
  await page.evaluate(() => window.calendarContract.status('SUBSCRIBED'));
  await page.clock.runFor(151);
  await readCount(page, 1);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual([]);
  // This snapshot starts while replication is still unavailable. A later
  // write in the gap will have no ordinary event, even though the socket joined.
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await readCount(page, 2);
  await page.evaluate(() => {
    window.calendarContract.system(null);
    window.calendarContract.system({ extension: 'presence', status: 'ok' });
    window.calendarContract.system({ extension: 'postgres_changes', status: 'error' });
  });
  await page.clock.runFor(151);
  await readCount(page, 2);
  await page.evaluate(() => window.calendarContract.system({ extension: 'postgres_changes', status: 'ok' }));
  await page.clock.runFor(151);
  await readCount(page, 3);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual(['refresh']);
  await resolveRead(page, 2, 'nach Datenbankbereitschaft');
  await resolveRead(page, 1, 'veraltete Antwort');
  await expect(page.getByLabel('Daten')).toHaveText('nach Datenbankbereitschaft');
});

test('removed organization channel cannot deliver queued row, deletion or readiness callbacks', async ({ page }) => {
  await resolveRead(page, 0, 'vorher');
  const lateDelivery = await page.evaluateHandle(() => window.calendarContract.captureLateDelivery());
  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  await readCount(page, 2);
  await resolveRead(page, 1, 'andere Organisation');
  await lateDelivery.evaluate(deliver => deliver());
  await page.clock.runFor(151);
  await readCount(page, 2);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual([]);
  await expect(page.getByLabel('Daten')).toHaveText('andere Organisation');
  await lateDelivery.dispose();
});

test("held mutation queues range navigation and manual refresh until settlement", async ({ page }) => {
  await resolveRead(page, 0, "vorher");
  await expect(page.getByLabel("Daten")).toHaveText("vorher");
  await page.getByRole("button", { name: "Speichern starten", exact: true }).click();
  await page.getByRole("button", { name: "Woche", exact: true }).click();
  await page.getByRole("button", { name: "Aktualisieren" }).click();
  await page.evaluate(() => window.calendarContract.emit());
  await page.clock.runFor(400);
  await readCount(page, 1);
  await expect(page.getByLabel("Daten")).toHaveText("optimistisch");
  await page.getByRole("button", { name: "Speichern beenden", exact: true }).click();
  await page.clock.runFor(151);
  // One read starts after both the save and queued invalidation; it covers both.
  await readCount(page, 2);
  await resolveRead(page, 1, "bestätigt");
  await expect(page.getByLabel("Daten")).toHaveText("bestätigt");
  await expect(page.getByRole("button", { name: "Aktualisieren" })).toBeEnabled();
});

test("scope switch cancels old mutation timer and rejects the old response", async ({ page }) => {
  await resolveRead(page, 0, "Organisation A");
  await expect(page.getByLabel("Daten")).toHaveText("Organisation A");
  await page.getByRole("button", { name: "Speichern starten", exact: true }).click();
  await page.getByRole("button", { name: "Speichern beenden", exact: true }).click();
  await page.getByRole("button", { name: "Organisation wechseln" }).click();
  await readCount(page, 2);
  await expect(page.getByLabel("Daten")).toHaveText("");
  await resolveRead(page, 1, "Organisation B");
  await page.clock.runFor(400);
  await readCount(page, 2);
  await expect(page.getByLabel("Daten")).toHaveText("Organisation B");
  expect(await page.evaluate(() => window.calendarContract.reads.map((read) => read.organizationId))).toEqual(["org-a", "org-b"]);
});

test("rapid range changes reject a held obsolete response instead of replacing the latest window", async ({ page }) => {
  await page.getByRole("button", { name: "Woche", exact: true }).click();
  await readCount(page, 2);
  await page.getByRole("button", { name: "Tag", exact: true }).click();
  // A pending week covers this day; it may complete once without an extra read.
  await resolveRead(page, 1, "aktuelles Fenster");
  await expect(page.getByLabel("Daten")).toHaveText("aktuelles Fenster");
  await resolveRead(page, 0, "veraltetes Fenster");
  await expect(page.getByLabel("Daten")).toHaveText("aktuelles Fenster");
});

test("old-organization held read cannot replace the new organization's completed read", async ({ page }) => {
  await page.getByRole("button", { name: "Organisation wechseln" }).click();
  await readCount(page, 2);
  await resolveRead(page, 1, "Organisation B");
  await expect(page.getByLabel("Daten")).toHaveText("Organisation B");
  await resolveRead(page, 0, "Organisation A verspätet");
  await expect(page.getByLabel("Daten")).toHaveText("Organisation B");
});

test("an operation releases only its own lease, including transport failure and duplicate completion", async ({ page }) => {
  await resolveRead(page, 0, "vorher");
  await page.getByRole("button", { name: "Speichern starten", exact: true }).click();
  await page.getByRole("button", { name: "Zweites Speichern starten", exact: true }).click();
  await page.getByRole("button", { name: "Transportfehler auslösen" }).click();
  await expect(page.getByLabel("Transportfehler")).toHaveText("fehlgeschlagen");
  await page.getByRole("button", { name: "Speichern beenden", exact: true }).click();
  await page.getByRole("button", { name: "Speichern beenden", exact: true }).click();
  await page.getByRole("button", { name: "Aktualisieren", exact: true }).click();
  await page.getByRole("button", { name: "Woche", exact: true }).click();
  await page.clock.runFor(400);
  await readCount(page, 1);
  await expect(page.getByLabel("Mutationen")).toHaveText("aktiv");
  await page.getByRole("button", { name: "Zweites Speichern beenden", exact: true }).click();
  await page.clock.runFor(151);
  await readCount(page, 2);
  await resolveRead(page, 1, "wiederhergestellt");
  await expect(page.getByLabel("Mutationen")).toHaveText("frei");
  await expect(page.getByLabel("Daten")).toHaveText("wiederhergestellt");
});

test("calendar visibility filters support keyboard and label activation without double toggles", async ({ page }) => {
  const workingHours = page.getByRole("checkbox", { name: "Arbeitszeiten", exact: true });
  const jobs = page.getByRole("checkbox", { name: "Aufträge", exact: true });
  await expect(workingHours).not.toBeChecked();
  await expect(jobs).toBeChecked();
  await workingHours.focus();
  await page.keyboard.press("Space");
  await expect(workingHours).toBeChecked();
  await expect(jobs).toBeChecked();
  await page.getByRole("group", { name: "Angezeigte Einträge" }).getByText("Arbeitszeiten", { exact: true }).click();
  await expect(workingHours).not.toBeChecked();
  await jobs.focus();
  await page.keyboard.press("Space");
  await expect(jobs).not.toBeChecked();
  await page.getByRole("group", { name: "Angezeigte Einträge" }).getByText("Aufträge", { exact: true }).click();
  await expect(jobs).toBeChecked();
});


test("closure invalidation uses the range owner, keeps failed coverage stale and commits a recovered removal", async ({ page }) => {
  await page.evaluate(() => window.calendarContract.resolveRead(0, "Auftrag", true, "Betriebsruhe"));
  await expect(page.getByLabel("Betriebsruhe", { exact: true })).toHaveText("Betriebsruhe");
  await page.evaluate(() => window.calendarContract.emit("organization_closure_days"));
  await page.clock.runFor(151);
  await readCount(page, 2);
  await resolveRead(page, 1, "", false);
  await expect(page.getByLabel("Fehler", { exact: true })).toHaveText("1");
  await expect(page.getByLabel("Betriebsruhe", { exact: true })).toHaveText("Betriebsruhe");
  await page.getByRole("button", { name: "Aktualisieren", exact: true }).click();
  await readCount(page, 3);
  await resolveRead(page, 2, "Auftrag");
  await expect(page.getByLabel("Betriebsruhe", { exact: true })).toBeEmpty();
  await expect(page.getByLabel("Zustand", { exact: true })).toHaveText("ready");
});
