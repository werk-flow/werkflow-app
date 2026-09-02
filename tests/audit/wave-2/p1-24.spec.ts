import { expect, test } from "../../golden/support/fixtures";
import { getP124CountsAs, getP124NoLoginRecordId, getP124State } from "../../golden/support/db";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import {
  createPersonnelRecordViaDialog,
  selectFromSearchable,
  textInDom,
  typeIntoDatePicker,
  visibleText,
} from "../../golden/support/steps";

test.describe.configure({ mode: "serial" });

const entryDate = ownedBerlinDateAtOffset("p1-24", 125);
let noLoginRecordId = "";

function dateDigits(isoDate: string): string {
  return `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}${isoDate.slice(0, 4)}`;
}

async function uploadProtectedFile(
  page: import("@playwright/test").Page,
  input: {
    fileName: string;
    documentType: string;
    accessClass?: "admin_restricted" | "health_evidence";
  },
): Promise<void> {
  const lifecycle = page.getByTestId("personnel-lifecycle");
  await lifecycle.getByRole("button", { name: "Datei", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Geschützte Personalunterlage" });
  await dialog.getByLabel("Datei").setInputFiles({
    name: input.fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(`P1-24 audit ${input.documentType}`),
  });
  await dialog.getByLabel("Dokumentart").fill(input.documentType);
  if (input.accessClass) {
    const accessClassLabels = {
      admin_restricted: "Nur Admin",
      health_evidence: "Gesundheitsnachweis",
    } as const;
    await selectFromSearchable(
      page,
      dialog.getByRole("combobox").filter({ hasText: "Personalunterlage" }),
      accessClassLabels[input.accessClass],
    );
  }
  await dialog.getByRole("button", { name: "Hochladen" }).click();
  await expect(visibleText(lifecycle, input.fileName)).toBeVisible({ timeout: 20_000 });
}

test.describe("P1-24 lifecycle audit @AUDIT-W2-P1-24 @AUDIT-W2", () => {
  // Catalog mapping: F01…F18 are exercised here and in Golden setup;
  // F19…F38 are covered by the protected-document Golden stage and checked
  // SQL; F39…F55 by the access/transition stages and lifecycle units; F56…F66
  // by this role boundary, RLS helpers, SQL assertions and closure evidence.
  test("keeps a future starter usable without login and separates protected classes", async ({ adminPage, bueroPage, world }) => {
    const lastName = `Lebenslauf-${world.runId}`;
    noLoginRecordId = await getP124NoLoginRecordId(world.orgId, lastName) ??
      await createPersonnelRecordViaDialog(adminPage, {
        firstName: "Lina",
        lastName,
        entryDateDigits: dateDigits(entryDate),
      });
    await adminPage.goto(`/mitarbeiter/${noLoginRecordId}`);
    const lifecycle = adminPage.getByTestId("personnel-lifecycle");
    await expect(visibleText(lifecycle, "Noch keine kontrollierte Zugangsregel.")).toBeVisible();
    await expect(visibleText(lifecycle, "Nicht eingerichtet. Es wurde kein Plan aus Bestandsdaten abgeleitet.")).toBeVisible();

    if (await visibleText(lifecycle, "personal-standard.txt").count() === 0) {
      await uploadProtectedFile(adminPage, {
        fileName: "personal-standard.txt",
        documentType: "Personalstammunterlage",
      });
    }
    if (await visibleText(lifecycle, "admin-vertraulich.txt").count() === 0) {
      await uploadProtectedFile(adminPage, {
        fileName: "admin-vertraulich.txt",
        documentType: "Vertrauliche Vereinbarung",
        accessClass: "admin_restricted",
      });
    }
    await expect(
      lifecycle.getByRole("listitem").filter({ hasText: "personal-standard.txt" }).getByRole("button", { name: "Freigeben" }),
    ).toBeDisabled();
    await expect(
      lifecycle.getByRole("listitem").filter({ hasText: "admin-vertraulich.txt" }).getByRole("button", { name: "Freigeben" }),
    ).toBeDisabled();

    await bueroPage.goto(`/mitarbeiter/${noLoginRecordId}`);
    const bueroLifecycle = bueroPage.getByTestId("personnel-lifecycle");
    await expect(visibleText(bueroLifecycle, "personal-standard.txt")).toBeVisible();
    await expect(textInDom(bueroPage, "admin-vertraulich.txt")).toHaveCount(0);
    await expect(bueroLifecycle.getByRole("button", { name: "Zugang steuern" })).toHaveCount(0);

    const state = await getP124State(world.orgId);
    expect(state.protectedDocuments.filter((item) => item.employee_record_id === noLoginRecordId)).toHaveLength(2);
    expect(state.releases.filter((item) => item.employee_record_id === noLoginRecordId)).toHaveLength(0);
  });

  test("records a planned employment transition and enforces organization isolation", async ({ adminPage, outsiderPage, world }) => {
    noLoginRecordId = await getP124NoLoginRecordId(world.orgId, `Lebenslauf-${world.runId}`) ?? "";
    expect(noLoginRecordId).not.toBe("");
    await adminPage.goto(`/mitarbeiter/${noLoginRecordId}`);
    const lifecycle = adminPage.getByTestId("personnel-lifecycle");
    await lifecycle.getByRole("button", { name: "Übergang erfassen" }).click();
    const dialog = adminPage.getByRole("dialog", { name: "Beschäftigungsübergang erfassen" });
    await selectFromSearchable(
      adminPage,
      dialog.getByRole("combobox").filter({ hasText: "Austritt vormerken" }),
      "Eintritt planen",
    );
    await typeIntoDatePicker(dialog, "Wirksam am", dateDigits(entryDate));
    await dialog.getByLabel("Grund").fill("Geplanter Eintritt ohne vorgezogenen Zugang");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(visibleText(lifecycle, "Eintritt geplant")).toBeVisible({ timeout: 15_000 });

    await outsiderPage.goto(`/mitarbeiter/${noLoginRecordId}`);
    await expect(outsiderPage).not.toHaveURL(new RegExp(noLoginRecordId), { timeout: 15_000 });
    const outsiderCounts = await getP124CountsAs(world.outsider.admin, world.orgId);
    expect(Object.keys(outsiderCounts)).toHaveLength(7);
    for (const [table, count] of Object.entries(outsiderCounts)) {
      expect(count, `outsider read ${table}`).toBe(0);
    }

    const state = await getP124State(world.orgId);
    const employment = state.employment.filter((item) => item.employee_record_id === noLoginRecordId);
    const transitions = state.employmentTransitions.filter((item) => item.employee_record_id === noLoginRecordId);
    expect(employment).toHaveLength(1);
    expect(employment[0]).toMatchObject({ state: "planned", scheduled_state: "active" });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.transition_kind).toBe("plan_start");
  });
});
