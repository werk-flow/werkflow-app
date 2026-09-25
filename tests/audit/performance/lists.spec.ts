import { expect, test } from "../support/fixtures";
import { expectUsableWithin } from "../../golden/support/scenario-measurement";
import { listTarget } from "../../golden/support/browser-observation";
import { visibleText } from "../../golden/support/steps/shared";
import { seedTypicalProfile, TYPICAL_PROFILE, type TypicalProfileCounts } from "../support/performance-profile";
import { createPerformancePage, loadingList, usableListCount } from "../support/performance-steps";
import { requireChainedValue } from "../../golden/support/preconditions";
import { auditCheckpoint, saveAuditCheckpoint } from "../support/checkpoints";
import { LIST_PAGE_SIZE } from "../../../lib/ui/list-pagination";

// Measures a usable first page under the full organization workload.
// Separate untimed checks below prove global search and page navigation.

test.describe("Performance profile lists @AUDIT-PERFORMANCE", () => {
  test("PERF-L1 seeds the typical profile into the group's organization @AUDIT-PERFORMANCE-L1", async ({ world }) => {
    const counts: TypicalProfileCounts = await seedTypicalProfile(world);
    saveAuditCheckpoint("performance.typicalProfile", { windowFrom: counts.window.from, assignedJobNumber: counts.assignedJobNumber });
    expect(counts.customers).toBe(TYPICAL_PROFILE.customers);
    expect(counts.jobs).toBe(TYPICAL_PROFILE.jobs);
    expect(counts.assignments).toBeGreaterThan(0);
  });

  test("PERF-L2 the customer and job lists open with the typical profile and render assignments @AUDIT-PERFORMANCE-L2", async ({ adminPage, world }) => {
    const seeded = requireChainedValue(auditCheckpoint("performance.typicalProfile")?.assignedJobNumber ?? "", {
      test: "PERF-L2", needs: "the seeded typical profile from PERF-L1", grep: "PERF-L1|PERF-L2", suite: "audit",
    });
    for (const sample of [1, 2, 3]) {
    const { context, page } = await createPerformancePage(adminPage);
    try {
    await test.step(`Declared list navigation sample ${sample}`, async () => {
    await expectUsableWithin("customers.list.open", {
      page,
      trigger: () => page.goto("/kunden"),
      usable: listTarget(page, "kunden"),
    });
    expect(await usableListCount(page, "kunden")).toBe(LIST_PAGE_SIZE);
    await expect(page.getByRole("navigation", { name: "Kunden", exact: true }).getByRole("status", { name: "Eintragsanzahl", exact: true })).toContainText(`von ${TYPICAL_PROFILE.customers}`);

    await expectUsableWithin("jobs.list.open", {
      page,
      trigger: () => page.goto("/auftraege"),
      usable: listTarget(page, "auftraege"),
    });
    expect(await usableListCount(page, "auftraege")).toBeGreaterThan(0);
    expect(await usableListCount(page, "auftraege")).toBeLessThanOrEqual(LIST_PAGE_SIZE * 2);
    // Assignment completeness is an untimed global-search assertion, independent
    // of the user's sort preference and the first page's identities.
    await page.getByRole("main").getByPlaceholder("Suche nach Titel, Nummer, Kunde, Ort...").filter({ visible: true }).fill(seeded);
    await expect(page.getByRole("navigation", { name: "Aktuelle Aufträge", exact: true }).getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–1 von 1");
    await expect(visibleText(page, seeded)).toBeVisible();
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await expect(page.getByRole("main").getByLabel(employeeName, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(loadingList(page, "auftraege")).toHaveCount(0);
    });
    } finally { await context.close(); }
    }
  });

  test("PERF-L3 pages and global search retain access to records beyond the initial page @AUDIT-PERFORMANCE-L3", async ({ adminPage, world }) => {
    requireChainedValue(auditCheckpoint("performance.typicalProfile")?.assignedJobNumber ?? "", {
      test: "PERF-L3", needs: "the seeded typical profile from PERF-L1", grep: "PERF-L1|PERF-L3", suite: "audit",
    });
    await adminPage.goto("/kunden");
    const customerPages = adminPage.getByRole("navigation", { name: "Kunden", exact: true });
    await expect(customerPages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toContainText(`1–50 von ${TYPICAL_PROFILE.customers}`);
    await customerPages.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(customerPages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toContainText(`51–100 von ${TYPICAL_PROFILE.customers}`);
    await expect(customerPages.getByRole("button", { name: "Zurück", exact: true })).toBeEnabled();
    const lastCustomer = `Kunde 1000 ${world.runId.slice(0, 6)}`;
    await adminPage.getByPlaceholder("Kunde, Ansprechpartner, Einsatzort...").fill(lastCustomer);
    await expect(visibleText(adminPage, lastCustomer)).toBeVisible();
    await expect(customerPages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–1 von 1");

    await adminPage.goto("/auftraege");
    const jobPages = adminPage.getByRole("navigation", { name: "Aktuelle Aufträge", exact: true });
    await expect(jobPages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toContainText("1–50 von");
    await jobPages.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(jobPages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toContainText("51–100 von");
    // This is the oldest seeded active job, behind more than 1,000 newer active jobs.
    const oldestJob = `PERF-${world.runId.slice(0, 6)}-0001`;
    await adminPage.getByRole("main").getByPlaceholder("Suche nach Titel, Nummer, Kunde, Ort...").filter({ visible: true }).fill(oldestJob);
    await expect(visibleText(adminPage, oldestJob)).toBeVisible();
    await expect(jobPages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–1 von 1");

    await adminPage.getByRole("button", { name: "Erstellen", exact: true }).click();
    const dialog = adminPage.getByRole("dialog").filter({ has: adminPage.getByRole("heading", { name: "Neuen Auftrag oder Projekt erstellen" }) });
    await dialog.getByRole("tab", { name: "Projekt erstellen", exact: true }).click();
    const picker = dialog.getByRole("combobox").filter({ hasText: "Aufträge zuweisen" });
    await expect(picker).toBeEnabled();
    await picker.click();
    await adminPage.getByPlaceholder("Auftrag suchen...").fill(oldestJob);
    const option = adminPage.getByRole("listbox").getByRole("option").filter({ hasText: oldestJob });
    await expect(option).toHaveCount(1);
    await option.click();
    await adminPage.keyboard.press("Escape");
    await expect(dialog.getByRole("combobox").filter({ hasText: "1 Auftrag" })).toBeVisible();
    // Reopening retains the exact selected entity after the query window changes.
    await dialog.getByRole("combobox").filter({ hasText: "1 Auftrag" }).click();
    await adminPage.getByPlaceholder("Auftrag suchen...").fill(oldestJob);
    await expect(option).toHaveAttribute("aria-selected", "true");
    await adminPage.keyboard.press("Escape");
    await adminPage.keyboard.press("Escape");
  });
});
