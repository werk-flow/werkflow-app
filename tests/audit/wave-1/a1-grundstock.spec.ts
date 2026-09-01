import { resolve } from "node:path";

import { expect, test } from "../../golden/support/fixtures";
import {
  getInventoryLedgerState,
  findLatestManualTimeEntryState,
  getJobCountByNumber,
  getJobProjectNumber,
  getLatestMembershipRemovalEvent,
  getOrganizationTimeEntrySnapshot,
  getPendingInviteCode,
} from "../../golden/support/db";
import {
  clockInOnJob,
  clockOut,
  createCustomer,
  createInventoryItem,
  createInventoryLocation,
  createJob,
  createOwnManualTimeEntry,
  createPlannedCalendarEntry,
  createProject,
  endClockBreak,
  expectVisibleAfterSave,
  editMetadataTextField,
  expectRedirectedAway,
  inviteMember,
  inputByValue,
  joinOrganizationViaInviteLink,
  loginViaUi,
  openCustomerDetail,
  openDialogWithRetry,
  openTimeApprovals,
  approvePendingTimeEntry,
  selectFromSearchable,
  showPlanningMonth,
  signOutViaUi,
  startClockBreak,
  switchClockJob,
  takeMaterialOnJobPage,
  typeIntoDatePicker,
  typeIntoTimeInput,
  visibleText,
  textInDom,
} from "../../golden/support/steps";
import { storageStatePath } from "../../golden/support/world";
import {
  confirmTestUserEmail,
  goldenTestEmail,
  goldenTestOrganizationName,
} from "../../golden/support/seed";
import {
  berlinDateAtOffset,
  ownedBerlinDateAtOffset,
} from "../../golden/support/date-ownership";
import {
  gotoReadOnlyRoute,
  requireChainedValue,
  requireSerialPrecondition,
  requireVisiblePrecondition,
} from "../../golden/support/preconditions";
import {
  bookMaterialDialog,
  calendarDay,
  calendarDayJobEvent,
  calendarJobEvent,
  calendarTimeline,
  clockInConfirmationButton,
  closeDocumentUploadProgressDialog,
  clockOutTimeGroup,
  confirmPlanningWarning,
  customerCountLabel,
  dayViewJobBlock,
  detailActionsButton,
  documentFolderUploadInput,
  documentUploadInput,
  expectSignedWindowOpen,
  firstDailyTimeSummary,
  inventoryLocationCard,
  jobTypeFilter,
  parkedJobPill,
  projectMaterialTotal,
  readOrganizationCode,
  setJobStatus,
  toggleInstructionItem,
  upgradeChoiceLink,
  visibleCalendarTimeBlock,
  visibleJobSearch,
  visibleMatchingText,
  visibleSortButton,
} from "../support/a1-steps";

test.describe.configure({ mode: "serial" });

test.describe("A1 Grundstock und Wave 0 @AUDIT-W1-A1", () => {
  let signupOrganizationCode = "";

  test("A1-01/A1-07: Konto, erste Organisation und Auto-Ausstempeln beim Abmelden", async ({
    browser,
    world,
  }) => {
    const context = await browser.newContext({ locale: "de-DE" });
    const page = await context.newPage();
    const email = goldenTestEmail("a1-signup", world.runId);
    const password = `A1-Sicher!${world.runId}2026`;
    const organizationName = goldenTestOrganizationName(
      "A1 Signup",
      world.runId,
    );

    await page.goto("/signup");
    await page.getByLabel("Vorname").fill("Sina");
    await page.getByLabel("Nachname").fill(`Audit-${world.runId}`);
    await page.getByLabel("E-Mail").fill(email);
    await page
      .getByRole("textbox", { name: "Passwort", exact: true })
      .fill(password);
    await page.getByRole("button", { name: "Registrieren" }).click();

    await expect(page).toHaveURL(/\/(verify|upgrade|onboarding)/, {
      timeout: 30_000,
    });
    if (/\/verify/.test(page.url())) {
      await confirmTestUserEmail(email);
      await page.goto("/login");
      await page.getByLabel("E-Mail", { exact: true }).fill(email);
      await page.getByLabel("Passwort", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page).toHaveURL(/\/(upgrade|onboarding)/, {
        timeout: 30_000,
      });
    }
    if (/\/onboarding\/start/.test(page.url())) {
      await upgradeChoiceLink(page).click();
      await expect(page).toHaveURL(/\/upgrade/, { timeout: 30_000 });
    }
    if (/\/upgrade/.test(page.url())) {
      await page
        .getByRole("button", { name: "Zahlung simulieren / Fortfahren" })
        .click();
      await expect(page).toHaveURL(/\/onboarding\/create-organization/, {
        timeout: 30_000,
      });
    }

    await page.getByLabel("Name der Organisation").fill(organizationName);
    await page.getByRole("button", { name: "Organisation erstellen" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(visibleText(page, organizationName)).toBeVisible();
    signupOrganizationCode = await readOrganizationCode(page);
    expect(signupOrganizationCode).toMatch(/^[A-Z0-9]{6}$/);
    await page.goto("/mitarbeiter");
    const ownerRow = page
      .getByRole("row")
      .filter({ hasText: `Sina Audit-${world.runId}` });
    await expect(ownerRow).toContainText("Admin");
    await expect(
      ownerRow.getByRole("button", { name: "Aktionen öffnen" }),
    ).toHaveCount(0);

    await clockInOnJob(page);
    await signOutViaUi(page);
    await loginViaUi(page, {
      email,
      password,
    });
    await expect(
      page.getByRole("button", { name: "Zeiterfassung starten" }),
    ).toBeVisible();
    await signOutViaUi(page);
    await context.close();
  });

  test("A1-02/A1-03: Beitritt per Code, Organisationswechsel und Datentrennung", async ({
    adminPage,
    browser,
    world,
  }) => {
    const signupCode = requireChainedValue(signupOrganizationCode, {
      test: "A1-02/A1-03",
      needs: "the organization code created by A1-01/A1-07",
      grep: "A1-01/A1-07|A1-02/A1-03",
      suite: "audit",
    });
    const primaryOrganizationCustomer = `Nur Hauptorg ${world.runId}`;
    await createCustomer(adminPage, primaryOrganizationCustomer);
    const secondaryOrganizationName = goldenTestOrganizationName(
      "A1 Zweitorg",
      world.runId,
    );
    await adminPage.goto("/dashboard");
    await adminPage
      .getByRole("button", { name: "Organisation erstellen" })
      .click();
    await adminPage
      .getByLabel("Name der Organisation")
      .fill(secondaryOrganizationName);
    await adminPage
      .getByRole("button", { name: "Erstellen", exact: true })
      .click();
    await expect(adminPage).toHaveURL(/\/dashboard\?created=/, {
      timeout: 30_000,
    });
    await expect(
      visibleText(adminPage, secondaryOrganizationName),
    ).toBeVisible();
    const secondaryOrganizationCode = await readOrganizationCode(adminPage);
    expect(secondaryOrganizationCode).toMatch(/^[A-Z0-9]{6}$/);

    await createCustomer(adminPage, `Nur Zweitorg ${world.runId}`);

    const employeeContext = await browser.newContext({
      storageState: storageStatePath("employee"),
    });
    const employeePage = await employeeContext.newPage();
    await employeePage.goto("/dashboard");
    await openDialogWithRetry({
      trigger: employeePage.getByRole("button", {
        name: "Organisation beitreten",
      }),
      dialog: employeePage.getByRole("dialog"),
    });
    await employeePage
      .getByLabel("Organisationscode")
      .fill(secondaryOrganizationCode);
    await employeePage
      .getByRole("button", { name: "Beitreten", exact: true })
      .click();
    await expect(employeePage).toHaveURL(/\/dashboard\?joined=/, {
      timeout: 30_000,
    });
    await expect(
      visibleText(employeePage, secondaryOrganizationName),
    ).toBeVisible();
    await expectRedirectedAway(employeePage, "/kunden");

    await openDialogWithRetry({
      trigger: employeePage.getByRole("button", {
        name: "Organisation beitreten",
      }),
      dialog: employeePage.getByRole("dialog"),
    });
    await employeePage.getByLabel("Organisationscode").fill(signupCode);
    await employeePage
      .getByRole("button", { name: "Beitreten", exact: true })
      .click();
    await expect(
      visibleText(
        employeePage,
        "Du kannst keiner Organisation beitreten, die nicht vom gleichen Admin stammt wie deine bestehenden Organisationen.",
      ),
    ).toBeVisible();
    await employeePage.keyboard.press("Escape");

    await selectFromSearchable(
      employeePage,
      employeePage
        .getByRole("combobox")
        .filter({ hasText: secondaryOrganizationName }),
      world.orgName,
      { searchFirst: false },
    );
    const employeeOrganizationSwitcher = employeePage
      .getByRole("combobox")
      .filter({
        hasText: world.orgName,
      });
    await expect(employeeOrganizationSwitcher).toBeDisabled();
    await expect(employeeOrganizationSwitcher).toBeEnabled({ timeout: 30_000 });
    await employeePage.goto("/auftraege");
    await expect(
      textInDom(employeePage, `Nur Zweitorg ${world.runId}`),
    ).toHaveCount(0);
    await employeeContext.close();

    await selectFromSearchable(
      adminPage,
      adminPage
        .getByRole("combobox")
        .filter({ hasText: secondaryOrganizationName }),
      world.orgName,
      { searchFirst: false },
    );
    const primaryOrganizationSwitcher = adminPage.getByRole("combobox").filter({
      hasText: world.orgName,
    });
    await expect(primaryOrganizationSwitcher).toBeDisabled();
    await expect(primaryOrganizationSwitcher).toBeEnabled({ timeout: 30_000 });
    await adminPage.goto("/kunden");
    await expect(
      textInDom(adminPage, `Nur Zweitorg ${world.runId}`),
    ).toHaveCount(0);
    await selectFromSearchable(
      adminPage,
      adminPage.getByRole("combobox").filter({ hasText: world.orgName }),
      secondaryOrganizationName,
      { searchFirst: false },
    );
    const secondaryOrganizationSwitcher = adminPage
      .getByRole("combobox")
      .filter({
        hasText: secondaryOrganizationName,
      });
    await expect(secondaryOrganizationSwitcher).toBeDisabled();
    await expect(secondaryOrganizationSwitcher).toBeEnabled({
      timeout: 30_000,
    });
    await adminPage.goto("/kunden");
    await expect(
      visibleText(adminPage, `Nur Zweitorg ${world.runId}`),
    ).toBeVisible();
    await expect(textInDom(adminPage, primaryOrganizationCustomer)).toHaveCount(
      0,
    );
    await selectFromSearchable(
      adminPage,
      adminPage
        .getByRole("combobox")
        .filter({ hasText: secondaryOrganizationName }),
      world.orgName,
      { searchFirst: false },
    );
    await expect(primaryOrganizationSwitcher).toBeDisabled();
    await expect(primaryOrganizationSwitcher).toBeEnabled({ timeout: 30_000 });
  });

  test("A1-04/A1-06: Handwerker-Oberfläche und konservative Rollenregeln", async ({
    adminPage,
    browser,
    bueroPage,
    employeePage,
    world,
  }) => {
    await expectRedirectedAway(employeePage, "/mitarbeiter");
    await adminPage.goto("/mitarbeiter");
    const adminOwnRow = adminPage.getByRole("row").filter({ hasText: "Greta" });
    await expect(adminOwnRow).toBeVisible();
    await expect(
      adminOwnRow.getByRole("button", { name: "Aktionen öffnen" }),
    ).toHaveCount(0);

    await bueroPage.goto("/mitarbeiter");
    const bueroOwnRow = bueroPage.getByRole("row").filter({ hasText: "Bruno" });
    const adminRow = bueroPage.getByRole("row").filter({ hasText: "Greta" });
    const employeeRow = bueroPage.getByRole("row").filter({ hasText: "Emil" });
    await expect(
      bueroOwnRow.getByRole("button", { name: "Aktionen öffnen" }),
    ).toHaveCount(0);
    await expect(
      adminRow.getByRole("button", { name: "Aktionen öffnen" }),
    ).toHaveCount(0);
    await expect(
      employeeRow.getByRole("button", { name: "Aktionen öffnen" }),
    ).toBeVisible();
    await expect(adminRow).toContainText("Admin");
    await expect(bueroOwnRow).toContainText("Büro");
    await expect(employeeRow).toContainText("Handwerker/in");
    await expect(employeeRow).toContainText(
      /Nicht eingestempelt|Arbeitet|Macht Pause/,
    );
    await expect(employeeRow.getByText("%")).toBeVisible();
    await expect(employeeRow.getByLabel(/Arbeitszeitmodell/)).toBeVisible();
    await employeeRow.getByRole("button", { name: "Aktionen öffnen" }).click();
    await expect(
      bueroPage.getByRole("menuitem", { name: "Details anzeigen" }),
    ).toBeVisible();
    await expect(
      bueroPage.getByRole("menuitem", { name: "Entfernen" }),
    ).toBeVisible();
    await expect(textInDom(bueroPage, "Rolle ändern")).toHaveCount(0);
    await bueroPage.keyboard.press("Escape");
    await expect(
      bueroPage.getByRole("menuitem", { name: "Details anzeigen" }),
    ).toBeHidden();

    await employeeRow
      .getByText(`Emil Golden-${world.runId}`, { exact: true })
      .click();
    await expect(bueroPage).toHaveURL(/\/mitarbeiter\//);
    await expect(visibleText(bueroPage, "Tagesfortschritt")).toBeVisible();

    const adminInviteEmail = `delivered+a1-admin-${world.runId}@resend.dev`;
    const bueroInviteEmail = `delivered+a1-buero-${world.runId}@resend.dev`;
    await inviteMember(adminPage, adminInviteEmail, "Büro");
    await adminPage.getByRole("tab", { name: "Einladungen" }).click();
    const adminInviteRow = adminPage
      .getByRole("row")
      .filter({ hasText: adminInviteEmail });
    await expect(adminInviteRow).toContainText("Büro");
    await expect(adminInviteRow).toContainText("Ausstehend");
    await adminInviteRow
      .getByRole("button", { name: "Aktionen öffnen" })
      .click();
    await adminPage.getByRole("menuitem", { name: "Stornieren" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Stornieren" })
      .click();
    await expect(adminInviteRow).toContainText("Storniert", {
      timeout: 20_000,
    });

    await inviteMember(bueroPage, bueroInviteEmail, "Handwerker/in");
    await bueroPage.getByRole("tab", { name: "Einladungen" }).click();
    const bueroInviteRow = bueroPage
      .getByRole("row")
      .filter({ hasText: bueroInviteEmail });
    await expect(bueroInviteRow).toContainText("Handwerker/in");
    await expect(bueroInviteRow).toContainText("Ausstehend");

    await inviteMember(adminPage, world.invitee.email, "Büro");
    const inviteCode = await getPendingInviteCode(
      world.orgId,
      world.invitee.email,
    );
    const inviteeContext = await browser.newContext({ locale: "de-DE" });
    const inviteePage = await inviteeContext.newPage();
    await joinOrganizationViaInviteLink(
      inviteePage,
      inviteCode,
      world.invitee,
      world.orgId,
    );
    await expect(visibleText(inviteePage, world.orgName)).toBeVisible();
    await adminPage.goto("/mitarbeiter");
    const joinedInviteeRow = adminPage.getByRole("row").filter({
      hasText: world.invitee.firstName,
    });
    await expect(joinedInviteeRow).toContainText("Büro");

    await clockInOnJob(inviteePage);
    await expect(joinedInviteeRow).toContainText("Arbeitet", {
      timeout: 30_000,
    });
    await joinedInviteeRow
      .getByRole("button", { name: "Aktionen öffnen" })
      .click();
    await adminPage.getByRole("menuitem", { name: "Entfernen" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Entfernen" })
      .click();
    await expect(adminPage).toHaveURL(/\/mitarbeiter\?removed_member=/, {
      timeout: 20_000,
    });
    await expect
      .poll(() =>
        getLatestMembershipRemovalEvent(world.orgId, world.invitee.id),
      )
      .toEqual({ autoClockedOut: true });
    await inviteeContext.close();
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });

  test("A1-05/A1-26/A1-27/A1-28: Live-Status, Pause, Auftragwechsel und Org-Sperre", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const secondaryOrganizationName = goldenTestOrganizationName(
      "A1 Zweitorg",
      world.runId,
    );
    await employeePage.goto("/dashboard");
    await employeePage
      .getByRole("combobox", { name: "Organisation wählen" })
      .click();
    await requireVisiblePrecondition(
      employeePage
        .getByRole("listbox")
        .getByRole("button")
        .filter({ hasText: secondaryOrganizationName }),
      {
        test: "A1-05/A1-26/A1-27/A1-28",
        needs:
          "the employee membership in the secondary organization created by A1-02/A1-03",
        grep: "A1-01/A1-07|A1-02/A1-03|A1-05/A1-26/A1-27/A1-28",
        suite: "audit",
      },
    );
    await employeePage.keyboard.press("Escape");
    const firstJob = `A1 Zeitauftrag 1 ${world.runId}`;
    const secondJob = `A1 Zeitauftrag 2 ${world.runId}`;
    const timeProjectNumber = `A1-ZP-${world.runId}`;
    await createProject(adminPage, {
      projectNumber: timeProjectNumber,
      title: `A1 Zeitprojekt ${world.runId}`,
    });
    await createJob(adminPage, {
      jobNumber: `A1-Z1-${world.runId}`,
      title: firstJob,
      assignEmployeeName: "Emil",
      projectNumber: timeProjectNumber,
    });
    await createJob(adminPage, {
      jobNumber: `A1-Z2-${world.runId}`,
      title: secondJob,
      assignEmployeeName: "Emil",
      projectNumber: timeProjectNumber,
    });

    await employeePage.goto("/zeiterfassung");
    await expect(
      visibleText(employeePage, "Du bist nicht eingestempelt."),
    ).toBeVisible();
    await adminPage.goto("/mitarbeiter");
    await clockInOnJob(employeePage, firstJob);
    await employeePage.goto("/zeiterfassung");
    await expect(
      visibleText(employeePage, "Du arbeitest gerade."),
    ).toBeVisible();
    await expect(visibleText(employeePage, "Arbeitszeit")).toBeVisible();
    await expect(visibleText(employeePage, "Pause")).toBeVisible();
    await expect(visibleText(employeePage, "Überstunden heute")).toBeVisible();
    await expect(visibleText(adminPage, "Arbeitet")).toBeVisible({
      timeout: 30_000,
    });
    await startClockBreak(employeePage);
    await employeePage.goto("/zeiterfassung");
    await expect(
      visibleText(employeePage, "Du machst gerade Pause."),
    ).toBeVisible();
    await expect(visibleText(adminPage, "Macht Pause")).toBeVisible({
      timeout: 30_000,
    });
    await endClockBreak(employeePage, firstJob);
    await employeePage.goto("/zeiterfassung");
    await expect(
      visibleText(employeePage, "Du arbeitest gerade."),
    ).toBeVisible();
    await switchClockJob(employeePage, secondJob);

    await employeePage.goto("/dashboard");
    await selectFromSearchable(
      employeePage,
      employeePage.getByRole("combobox").filter({ hasText: world.orgName }),
      secondaryOrganizationName,
    );
    await expect(
      visibleText(employeePage, secondaryOrganizationName),
    ).toBeVisible({
      timeout: 20_000,
    });
    await employeePage
      .getByRole("button", { name: "Zeiterfassung starten" })
      .click();
    await clockInConfirmationButton(employeePage).click();
    await expect(
      visibleText(
        employeePage,
        "Bereits in anderer Organisation eingestempelt",
      ),
    ).toBeVisible({
      timeout: 20_000,
    });
    await selectFromSearchable(
      employeePage,
      employeePage
        .getByRole("combobox")
        .filter({ hasText: secondaryOrganizationName }),
      world.orgName,
    );
    await clockOut(employeePage);
    await employeePage.goto("/zeiterfassung");
    await expect(
      visibleText(employeePage, "Du bist nicht eingestempelt."),
    ).toBeVisible();
    await expect(visibleText(employeePage, "Arbeitszeit")).toBeVisible();
    await expect(visibleText(employeePage, "Pause")).toBeVisible();
    const dailyTimeSummaries = employeePage.getByRole("img", {
      name: /Anwesenheit.*Arbeitszeit.*Pause.*Überstunden/,
    });
    await expect(dailyTimeSummaries).toHaveCount(7);
    await expect(firstDailyTimeSummary(employeePage)).toHaveAttribute(
      "title",
      /Anwesenheit.*Arbeitszeit.*Pause.*Überstunden/,
    );
    await gotoReadOnlyRoute(employeePage, `/auftraege/A1-Z1-${world.runId}`);
    await expect(
      textInDom(
        employeePage,
        "Noch keine Arbeitszeiten für diesen Auftrag erfasst.",
      ),
    ).toHaveCount(0);
    await gotoReadOnlyRoute(employeePage, `/auftraege/A1-Z2-${world.runId}`);
    await expect(
      textInDom(
        employeePage,
        "Noch keine Arbeitszeiten für diesen Auftrag erfasst.",
      ),
    ).toHaveCount(0);
    await adminPage.goto(`/auftraege/projekt/${timeProjectNumber}`);
    const projectTimeSummary = visibleText(
      adminPage,
      "Gesamtstunden (alle Aufträge)",
    );
    try {
      await expect(projectTimeSummary).toBeVisible({ timeout: 20_000 });
    } catch {
      await adminPage.reload();
      await expect(projectTimeSummary).toBeVisible({ timeout: 30_000 });
    }
  });

  test("A1-09/A1-11: Kundendaten inline und Kunde direkt im Arbeitsdialog", async ({
    adminPage,
    world,
  }) => {
    const customerName = `A1 Kunde ${world.runId}`;
    const renamedCustomerName = `A1 Kunde Neu ${world.runId}`;
    await adminPage.goto("/kunden");
    const initialCount = Number(
      (await customerCountLabel(adminPage).textContent())?.split(" ")[0],
    );
    await adminPage.getByRole("button", { name: "Kunde hinzufügen" }).click();
    const createCustomerDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Neuen Kunden anlegen" }),
    });
    await createCustomerDialog.getByLabel("Name *").fill(customerName);
    await createCustomerDialog.getByLabel("Typ").click();
    await adminPage
      .getByRole("option", { name: "Gewerblich", exact: true })
      .click();
    await createCustomerDialog
      .getByLabel("E-Mail")
      .fill(`a1-kunde-${world.runId}@example.de`);
    await createCustomerDialog.getByLabel("Telefon").fill("+49 30 1234567");
    await createCustomerDialog
      .getByLabel("Adresse")
      .fill("Werkstraße 42, 10115 Berlin");
    await createCustomerDialog
      .getByLabel("Notizen")
      .fill("Bevorzugt Termine am Vormittag");
    await adminPage.getByRole("button", { name: "Kunde erstellen" }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Neuen Kunden anlegen" }),
    ).toBeHidden({
      timeout: 10_000,
    });
    // Documented delayed-refresh class (see the P1-02 golden-gate-log entry):
    // the post-create router.refresh() can arrive late under suite load. Give
    // it 15s, then reload once — the persisted count assertion stays strict.
    const nextCount = visibleMatchingText(
      adminPage,
      new RegExp(`^${initialCount + 1} Kunde(?:n)?$`),
    );
    try {
      await expect(nextCount).toBeVisible({ timeout: 15_000 });
    } catch {
      await adminPage.reload();
      await expect(nextCount).toBeVisible({ timeout: 15_000 });
    }
    const customerRow = adminPage
      .getByRole("row")
      .filter({ hasText: customerName });
    await expect(customerRow).toContainText("Gewerblich");
    await expect(customerRow).toContainText(
      `a1-kunde-${world.runId}@example.de`,
    );
    await expect(customerRow).toContainText("+49 30 1234567");
    await adminPage.getByLabel("Kunden durchsuchen").fill("+49 30 1234567");
    await expect(customerRow).toBeVisible();
    await adminPage.getByLabel("Kunden durchsuchen").fill("kein-a1-kunde");
    await expect(customerRow).toHaveCount(0);
    await adminPage.getByLabel("Kunden durchsuchen").fill("");
    await openCustomerDetail(adminPage, customerName);
    await expect(
      visibleText(adminPage, "Werkstraße 42, 10115 Berlin"),
    ).toBeVisible();
    await expect(
      visibleText(adminPage, "Bevorzugt Termine am Vormittag"),
    ).toBeVisible();
    await editMetadataTextField(adminPage, "Name", renamedCustomerName);
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible({
      timeout: 15_000,
    });
    await adminPage.reload();
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible();

    const inlineCustomer = `A1 Inlinekunde ${world.runId}`;
    await adminPage.goto("/auftraege");
    await adminPage
      .getByRole("button", { name: "Erstellen", exact: true })
      .click();
    await adminPage.getByRole("tab", { name: "Auftrag erstellen" }).click();
    await adminPage
      .getByRole("combobox")
      .filter({ hasText: "Kein Kunde" })
      .click();
    await adminPage
      .getByRole("button", { name: "Neuen Kunden erstellen" })
      .click();
    await adminPage
      .getByRole("dialog")
      .getByLabel("Name *")
      .fill(inlineCustomer);
    await adminPage.getByRole("button", { name: "Kunde erstellen" }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Neuen Kunden anlegen" }),
    ).toBeHidden({
      timeout: 15_000,
    });
    await expect(
      adminPage.getByRole("combobox").filter({ hasText: inlineCustomer }),
    ).toBeVisible();
    const inlineJobNumber = `A1-INLINE-${world.runId}`;
    const createJobDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", {
        name: "Neuen Auftrag oder Projekt erstellen",
      }),
    });
    await createJobDialog.getByLabel("Auftragsnummer *").fill(inlineJobNumber);
    await createJobDialog
      .getByLabel("Titel")
      .fill(`A1 Inlineauftrag ${world.runId}`);
    await adminPage
      .getByRole("button", { name: "Auftrag erstellen", exact: true })
      .click();
    await expect(
      adminPage.getByRole("heading", {
        name: "Neuen Auftrag oder Projekt erstellen",
      }),
    ).toBeHidden();
    await adminPage.goto(`/auftraege/${inlineJobNumber}`);
    await expect(visibleText(adminPage, inlineCustomer)).toBeVisible();
  });

  test("A1-R01: vollständige Auftragsdaten, Mehrfachzuweisung und Projektableitung [BASE-WORK-F01/F02/F05/F07]", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const renamedCustomerName = `A1 Kunde Neu ${world.runId}`;
    await adminPage.goto("/kunden");
    await requireVisiblePrecondition(
      visibleText(adminPage, renamedCustomerName),
      {
        test: "A1-R01",
        needs: "the renamed customer persisted by A1-09/A1-11",
        grep: "A1-09/A1-11|A1-R01",
        suite: "audit",
      },
    );
    const projectNumber = `A1-FULL-P-${world.runId}`;
    const projectTitle = `A1 Vollständiges Projekt ${world.runId}`;
    const jobNumber = `A1-FULL-J-${world.runId}`;
    const jobTitle = `A1 Vollständiger Auftrag ${world.runId}`;
    const plannedDate = ownedBerlinDateAtOffset("a1-grundstock", 65);

    await createProject(adminPage, {
      projectNumber,
      title: projectTitle,
      clientName: renamedCustomerName,
    });
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(
      visibleText(adminPage, "Noch keine Aufträge in diesem Projekt."),
    ).toBeVisible();
    await editMetadataTextField(
      adminPage,
      "Beschreibung",
      "Vollständige Projektbeschreibung",
    );

    await adminPage.goto("/auftraege");
    await adminPage
      .getByRole("button", { name: "Erstellen", exact: true })
      .click();
    const createDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", {
        name: "Neuen Auftrag oder Projekt erstellen",
      }),
    });
    await createDialog.getByRole("tab", { name: "Auftrag erstellen" }).click();
    await createDialog.locator("#job-number").fill(jobNumber);
    await createDialog.locator("#job-title").fill(jobTitle);
    await createDialog
      .locator("#job-description")
      .fill("Vollständige Auftragsbeschreibung");
    await createDialog
      .getByRole("combobox")
      .filter({ hasText: "Kein Kunde" })
      .click();
    const customerSearch = adminPage.getByPlaceholder("Kunde suchen...");
    await customerSearch.fill(renamedCustomerName);
    const customerOption = adminPage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: renamedCustomerName });
    await expect(customerOption).toBeVisible({ timeout: 10_000 });
    await customerOption.click();
    await createDialog.locator("#job-priority").click();
    await adminPage.getByRole("option", { name: "Hoch", exact: true }).click();
    await typeIntoDatePicker(
      createDialog,
      "Datum",
      plannedDate.split("-").reverse().join(""),
    );
    await typeIntoTimeInput(createDialog, "job-time", "0815");
    await createDialog.locator("#job-duration").fill("2,5");
    await createDialog.locator("#job-location").fill("Heizraum, Werkstraße 42");
    await createDialog
      .getByRole("combobox")
      .filter({ hasText: "Mitarbeiter zuweisen" })
      .click();
    await adminPage.getByPlaceholder("Mitarbeiter suchen...").fill("Emil");
    await adminPage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: "Emil" })
      .click();
    await adminPage.getByPlaceholder("Mitarbeiter suchen...").fill("Bruno");
    await adminPage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: "Bruno" })
      .click();
    await createDialog
      .getByRole("heading", { name: "Neuen Auftrag oder Projekt erstellen" })
      .click();
    await createDialog
      .getByRole("button", { name: "Auftrag erstellen", exact: true })
      .click();
    await expect(createDialog).toHaveCount(0, { timeout: 20_000 });

    await adminPage.goto(`/auftraege/${jobNumber}`);
    const details = adminPage
      .getByRole("heading", { name: "Details" })
      .locator("..");
    await expect(details).toContainText(jobNumber);
    await expect(details).toContainText("Vollständige Auftragsbeschreibung");
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible();
    await expect(details).toContainText("Hoch");
    await expect(details).toContainText(
      plannedDate.split("-").reverse().join("."),
    );
    await expect(details).toContainText("08:15");
    await expect(details).toContainText("2 Std. 30 Min.");
    await expect(details).toContainText("Heizraum, Werkstraße 42");
    await expect(visibleText(adminPage, "Emil")).toBeVisible();
    await expect(visibleText(adminPage, "Bruno")).toBeVisible();
    await expect(
      visibleText(adminPage, "Keinem Projekt zugeordnet"),
    ).toBeVisible();
    await employeePage.goto("/auftraege");
    await expect(visibleText(employeePage, jobNumber)).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await adminPage
      .getByRole("button", { name: "Zuweisen", exact: true })
      .click();
    const assignmentDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", {
        name: "Aufträge zum Projekt hinzufügen",
      }),
    });
    await assignmentDialog
      .getByRole("combobox")
      .filter({ hasText: "Aufträge zuweisen" })
      .click();
    await adminPage.getByPlaceholder("Auftrag suchen...").fill(jobNumber);
    await adminPage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: jobNumber })
      .click();
    await adminPage.keyboard.press("Escape");
    await assignmentDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(assignmentDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(visibleText(adminPage, jobNumber)).toBeVisible();
    await expect(visibleText(adminPage, "0%")).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${jobNumber}`);
    await expect(visibleText(adminPage, projectNumber)).toBeVisible();
    await expect
      .poll(() => getJobProjectNumber(world.orgId, jobNumber))
      .toBe(projectNumber);
    await setJobStatus(adminPage, "In Bearbeitung");
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleText(adminPage, "In Bearbeitung")).toBeVisible();
    await expect(
      adminPage
        .getByTitle(/Im Zeitplan|Leicht verzögert|Stark verzögert/)
        .filter({ visible: true }),
    ).not.toHaveCount(0);

    const projectLifecycle = adminPage
      .getByRole("main")
      .getByTestId("work-lifecycle-card");
    await projectLifecycle
      .getByRole("button", { name: "Storniert", exact: true })
      .click();
    let lifecycleDialog = adminPage.getByRole("dialog");
    await lifecycleDialog
      .locator("#work-transition-reason")
      .fill("Projektstatus im Grundstock bewusst übersteuert.");
    await lifecycleDialog
      .getByRole("button", { name: "Änderung speichern" })
      .click();
    await expect(lifecycleDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(
      projectLifecycle.getByText("Storniert", { exact: true }),
    ).toBeVisible();
    await projectLifecycle
      .getByRole("button", { name: "Automatisch ableiten" })
      .click();
    lifecycleDialog = adminPage.getByRole("dialog");
    await lifecycleDialog
      .locator("#work-reason")
      .fill("Projekt folgt wieder den Aufträgen.");
    await lifecycleDialog
      .getByRole("button", { name: "Automatisch ableiten" })
      .click();
    await expect(lifecycleDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(
      projectLifecycle.getByText("In Ausführung", { exact: true }),
    ).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${jobNumber}`);
    await setJobStatus(adminPage, "Fertig");
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleText(adminPage, "Abgeschlossen")).toBeVisible();
    await expect(visibleText(adminPage, "100%")).toBeVisible();
  });

  test("A1-10/A1-14: Kunden- und Projektlöschung erhalten die Arbeit", async ({
    adminPage,
    world,
  }) => {
    const renamedCustomerName = `A1 Kunde Neu ${world.runId}`;
    await adminPage.goto("/kunden");
    await requireVisiblePrecondition(
      visibleText(adminPage, renamedCustomerName),
      {
        test: "A1-10/A1-14",
        needs: "the renamed customer persisted by A1-09/A1-11",
        grep: "A1-09/A1-11|A1-10/A1-14",
        suite: "audit",
      },
    );
    const linkedJobNumber = `A1-KD-${world.runId}`;
    const linkedProjectNumber = `A1-PD-${world.runId}`;
    const projectTitle = `A1 Kundenprojekt ${world.runId}`;
    await createProject(adminPage, {
      projectNumber: linkedProjectNumber,
      title: projectTitle,
      clientName: renamedCustomerName,
    });
    await createJob(adminPage, {
      jobNumber: linkedJobNumber,
      title: `A1 Kundenauftrag ${world.runId}`,
      projectNumber: linkedProjectNumber,
    });

    await adminPage.goto(`/auftraege/projekt/${linkedProjectNumber}`);
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible();

    await openCustomerDetail(adminPage, renamedCustomerName);
    await detailActionsButton(adminPage).click();
    await adminPage.getByRole("menuitem", { name: "Kunde löschen" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Löschen" })
      .click();
    await expect(adminPage).toHaveURL(/\/kunden$/, { timeout: 60_000 });
    await adminPage.goto("/auftraege");
    await expect(visibleText(adminPage, linkedProjectNumber)).toBeVisible();
    await adminPage
      .getByRole("row", { name: new RegExp(linkedProjectNumber) })
      .getByRole("button", { name: "Projekt aufklappen" })
      .click();
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${linkedProjectNumber}`);
    await detailActionsButton(adminPage).click();
    await adminPage.getByRole("menuitem", { name: "Projekt löschen" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Löschen" })
      .click();
    await expect(adminPage).toHaveURL((url) => url.pathname === "/auftraege", {
      timeout: 20_000,
    });
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();
    await adminPage.goto(`/auftraege/${linkedJobNumber}`);
    await expect(
      visibleText(adminPage, "Keinem Projekt zugeordnet"),
    ).toBeVisible();
  });

  test("A1-12/A1-13: Zuweisung entfernen, bearbeiten und Auftrag löschen", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `A1-EDIT-${world.runId}`;
    const title = `A1 Auftrag bearbeiten ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title,
      assignEmployeeName: "Emil",
    });
    await employeePage.goto("/auftraege");
    await expect(visibleText(employeePage, jobNumber)).toBeVisible();

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await detailActionsButton(adminPage).click();
    await adminPage.getByRole("menuitem", { name: "Bearbeiten" }).click();
    const dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Auftrag bearbeiten" }),
    });
    await dialog.locator("#edit-job-title").fill(`${title} geändert`);
    const employeePicker = dialog
      .getByRole("combobox")
      .filter({ hasText: "1 Mitarbeiter" });
    await expect(employeePicker).toBeEnabled({ timeout: 20_000 });
    await employeePicker.click();
    await adminPage
      .getByRole("listbox")
      .getByRole("button", { name: /Emil/ })
      .click();
    // Close the multi-select popover via its trigger before submitting: the
    // pinned DialogFooter sits underneath it, and Playwright never dispatches
    // the outside click that would dismiss it for a real user. The trigger's
    // label changed with the deselection, so target it by its open state.
    await dialog
      .locator('button[role="combobox"][aria-expanded="true"]')
      .click();
    await expect(adminPage.getByRole("listbox")).toBeHidden();
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(visibleText(adminPage, `${title} geändert`)).toBeVisible();
    await employeePage.reload();
    await expect(textInDom(employeePage, jobNumber)).toHaveCount(0);

    await detailActionsButton(adminPage).click();
    await adminPage.getByRole("menuitem", { name: "Auftrag löschen" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Löschen" })
      .click();
    await expect(adminPage).toHaveURL((url) => url.pathname === "/auftraege", {
      timeout: 20_000,
    });
    await expect(
      adminPage.getByRole("row").filter({ hasText: jobNumber }),
    ).toHaveCount(0);
  });

  test("A1-15/A1-16: Entplanen bleibt Planung und Projektparken bewahrt fertige Kinder", async ({
    adminPage,
    world,
  }) => {
    const plannedDate = ownedBerlinDateAtOffset("a1-grundstock", 21);
    const plannedDateDigits = plannedDate.split("-").reverse().join("");
    const projectNumber = `A1-PARK-P-${world.runId}`;
    const projectTitle = `A1 Parkprojekt ${world.runId}`;
    const unfinishedNumber = `A1-PARK-OFFEN-${world.runId}`;
    const finishedNumber = `A1-PARK-FERTIG-${world.runId}`;
    await createProject(adminPage, { projectNumber, title: projectTitle });
    await createJob(adminPage, {
      jobNumber: unfinishedNumber,
      title: `A1 Parken offen ${world.runId}`,
      projectNumber,
      plannedDateDigits,
    });
    await createJob(adminPage, {
      jobNumber: finishedNumber,
      title: `A1 Parken fertig ${world.runId}`,
      projectNumber,
      plannedDateDigits,
    });
    await adminPage.goto(
      `/auftraege/projekt/${projectNumber}/${finishedNumber}`,
    );
    await setJobStatus(adminPage, "Fertig");
    await expect(visibleText(adminPage, "Fertig")).toBeVisible();

    await adminPage.goto(
      `/auftraege/projekt/${projectNumber}/${unfinishedNumber}`,
    );
    await adminPage
      .getByRole("button", { name: "Geplantes Datum bearbeiten" })
      .click();
    await adminPage.getByRole("button", { name: "Leeren" }).click();
    await adminPage
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Datum entfernen" })
      .click();
    await expect(
      adminPage
        .getByRole("main")
        .getByTestId("work-lifecycle-card")
        .getByText("Nicht geplant", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(textInDom(adminPage, "Geparkt")).toHaveCount(0);
    await adminPage
      .getByRole("button", { name: "Geplantes Datum bearbeiten" })
      .click();
    await typeIntoDatePicker(
      adminPage.getByRole("main"),
      "Datum",
      plannedDateDigits,
    );
    await adminPage
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(textInDom(adminPage, "Geparkt")).toHaveCount(0);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleMatchingText(adminPage, /50\s*%/)).toBeVisible();
    const projectLifecycle = adminPage
      .getByRole("main")
      .getByTestId("work-lifecycle-card");
    await projectLifecycle
      .getByRole("button", { name: "Parken", exact: true })
      .click();
    const parkDialog = adminPage.getByRole("dialog");
    await parkDialog.locator("#work-blocker-reason").click();
    await adminPage
      .getByRole("option", { name: "Kapazität", exact: true })
      .click();
    await parkDialog
      .locator("#work-blocker-details")
      .fill("Projekt wird bis zur neuen Kapazitätsplanung geparkt.");
    await selectFromSearchable(
      adminPage,
      parkDialog.locator("#work-blocker-owner"),
      world.users.admin.firstName,
    );
    await typeIntoDatePicker(
      parkDialog,
      "Wiedervorlage",
      berlinDateAtOffset(7).split("-").reverse().join(""),
    );
    await parkDialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(parkDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(visibleText(adminPage, "Geparkt")).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.goto(
      `/auftraege/projekt/${projectNumber}/${unfinishedNumber}`,
    );
    await expect(visibleText(adminPage, "Geparkt")).toBeVisible();
    await adminPage.goto(
      `/auftraege/projekt/${projectNumber}/${finishedNumber}`,
    );
    await expect(visibleText(adminPage, "Fertig")).toBeVisible();
    await expect(visibleText(adminPage, "Abschlussdatum")).toBeVisible();
  });

  test("A1-17/A1-18: Checkliste, Attribution und Abschlussdatum", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const checklistJobNumber = `A1-CHECK-${world.runId}`;
    const title = `A1 Checkliste ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: checklistJobNumber,
      title,
      assignEmployeeName: "Emil",
    });
    await adminPage.goto(`/auftraege/${checklistJobNumber}`);
    await adminPage
      .getByRole("textbox", { name: "Neuen Arbeitsanweisungs-Punkt eingeben" })
      .fill("Anlage druckprüfen");
    await adminPage
      .getByRole("textbox", { name: "Neuen Arbeitsanweisungs-Punkt eingeben" })
      .press("Enter");
    await expect(visibleText(adminPage, "Erstellt von Greta")).toBeVisible({
      timeout: 15_000,
    });
    const persistedInstruction = await inputByValue(
      adminPage,
      "Arbeitsanweisungs-Punkt bearbeiten",
      "Anlage druckprüfen",
    );
    await expect(persistedInstruction).toHaveValue("Anlage druckprüfen");
    await expect(
      persistedInstruction.locator("xpath=../../.."),
    ).not.toHaveClass(/opacity-80/, {
      timeout: 15_000,
    });
    await adminPage
      .getByRole("textbox", { name: "Neuen Arbeitsanweisungs-Punkt eingeben" })
      .fill("Ventile beschriften");
    await adminPage
      .getByRole("textbox", { name: "Neuen Arbeitsanweisungs-Punkt eingeben" })
      .press("Enter");
    const secondInstruction = await inputByValue(
      adminPage,
      "Arbeitsanweisungs-Punkt bearbeiten",
      "Ventile beschriften",
    );
    await expect(secondInstruction).toBeVisible({ timeout: 15_000 });
    await expect(secondInstruction.locator("xpath=../../..")).not.toHaveClass(
      /opacity-80/,
      {
        timeout: 15_000,
      },
    );
    const moveSecondInstructionUp = secondInstruction
      .locator("xpath=../../..")
      .getByRole("button", { name: "Punkt nach oben verschieben" });
    await moveSecondInstructionUp.click();
    await expect(moveSecondInstructionUp).toBeDisabled();
    await expect(moveSecondInstructionUp).toBeEnabled({ timeout: 20_000 });
    await adminPage.reload();
    const orderedInstructions = adminPage.getByRole("textbox", {
      name: "Arbeitsanweisungs-Punkt bearbeiten",
    });
    await expect(orderedInstructions).toHaveCount(2);
    expect(
      await orderedInstructions.evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      ),
    ).toEqual(["Ventile beschriften", "Anlage druckprüfen"]);

    await employeePage.goto(`/auftraege/${checklistJobNumber}`);
    const ventileInstruction = visibleText(
      employeePage,
      "Ventile beschriften",
    ).locator("xpath=../../..");
    await toggleInstructionItem(
      employeePage,
      ventileInstruction.getByRole("button", {
        name: "Punkt als erledigt markieren",
      }),
      true,
    );
    await expect(
      visibleText(employeePage, "Zuletzt erledigt von Emil"),
    ).toBeVisible();
    await toggleInstructionItem(
      employeePage,
      ventileInstruction.getByRole("button", {
        name: "Punkt als offen markieren",
      }),
      false,
    );
    await expect(
      visibleText(employeePage, "Zuletzt offen von Emil"),
    ).toBeVisible();
    await toggleInstructionItem(
      employeePage,
      ventileInstruction.getByRole("button", {
        name: "Punkt als erledigt markieren",
      }),
      true,
    );
    await expect(
      ventileInstruction.getByRole("button", {
        name: "Punkt als offen markieren",
      }),
    ).toBeVisible({ timeout: 20_000 });
    const pressureTestInstruction = visibleText(
      employeePage,
      "Anlage druckprüfen",
    ).locator("xpath=../../..");
    await toggleInstructionItem(
      employeePage,
      pressureTestInstruction.getByRole("button", {
        name: "Punkt als erledigt markieren",
      }),
      true,
    );
    await expect(
      pressureTestInstruction.getByRole("button", {
        name: "Punkt als offen markieren",
      }),
    ).toBeVisible({ timeout: 20_000 });

    await adminPage.reload();
    await setJobStatus(adminPage, "Fertig");
    const completionDate = berlinDateAtOffset(0).split("-").reverse().join(".");
    const completionRow = visibleText(adminPage, "Abschlussdatum").locator(
      "..",
    );
    await expect(completionRow).toContainText(completionDate, {
      timeout: 20_000,
    });
  });

  test("A1-19: Auftragsliste sucht, filtert, sortiert, klappt Projekte auf und aktualisiert live [BASE-WORK-F08/P1-00-F01]", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    requireSerialPrecondition(
      (await getJobCountByNumber(world.orgId, `A1-Z1-${world.runId}`)) === 1,
      {
        test: "A1-19",
        needs: "the first time-tracking job created by A1-05/A1-26/A1-27/A1-28",
        grep: "A1-01/A1-07|A1-02/A1-03|A1-05/A1-26/A1-27/A1-28|A1-19",
        suite: "audit",
      },
    );
    const listJobNumber = `A1-LIST-${world.runId}`;
    const listCustomer = `A1 Listenkunde ${world.runId}`;
    await createCustomer(adminPage, listCustomer);
    await createJob(adminPage, {
      jobNumber: listJobNumber,
      title: `A1 Listenauftrag ${world.runId}`,
      clientName: listCustomer,
      assignEmployeeName: "Emil",
      plannedDateDigits: ownedBerlinDateAtOffset("a1-grundstock", 20)
        .split("-")
        .reverse()
        .join(""),
    });
    const listProjectNumber = `A1-LIST-P-${world.runId}`;
    await createProject(adminPage, {
      projectNumber: listProjectNumber,
      title: `A1 Listenprojekt ${world.runId}`,
      clientName: listCustomer,
    });
    const listChildNumber = `A1-LIST-C-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: listChildNumber,
      title: `A1 Listenprojektauftrag ${world.runId}`,
      projectNumber: listProjectNumber,
      assignEmployeeName: "Emil",
      plannedDateDigits: ownedBerlinDateAtOffset("a1-grundstock", 21)
        .split("-")
        .reverse()
        .join(""),
    });
    const parkingJobNumber = `A1-PARK-LIST-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: parkingJobNumber,
      title: `A1 Parkplatzliste ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/${parkingJobNumber}`);
    const parkingLifecycle = adminPage
      .getByRole("main")
      .getByTestId("work-lifecycle-card");
    await parkingLifecycle
      .getByRole("button", { name: "Parken", exact: true })
      .click();
    const parkingDialog = adminPage.getByRole("dialog");
    await parkingDialog.locator("#work-blocker-reason").click();
    await adminPage
      .getByRole("option", { name: "Kapazität", exact: true })
      .click();
    await parkingDialog
      .locator("#work-blocker-details")
      .fill("Auftrag bleibt bis zur nächsten Kapazitätsprüfung im Parkplatz.");
    await selectFromSearchable(
      adminPage,
      parkingDialog.locator("#work-blocker-owner"),
      world.users.admin.firstName,
    );
    await typeIntoDatePicker(
      parkingDialog,
      "Wiedervorlage",
      berlinDateAtOffset(7).split("-").reverse().join(""),
    );
    await parkingDialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(parkingDialog).toHaveCount(0, { timeout: 20_000 });
    const archiveJobNumber = `A1-ARCHIV-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: archiveJobNumber,
      title: `A1 Archivliste ${world.runId}`,
      plannedDateDigits: ownedBerlinDateAtOffset("a1-grundstock", 20)
        .split("-")
        .reverse()
        .join(""),
    });
    await adminPage.goto(`/auftraege/${archiveJobNumber}`);
    await setJobStatus(adminPage, "Fertig");
    await adminPage.goto("/auftraege");
    const search = visibleJobSearch(adminPage);
    await search.fill(listJobNumber);
    await expect(visibleText(adminPage, listJobNumber)).toBeVisible();
    await search.fill("kein-treffer-a1");
    await expect(textInDom(adminPage, listJobNumber)).toHaveCount(0);
    await search.fill("");
    const activeSection = adminPage
      .getByRole("heading", { name: "Aktuelle Aufträge und Projekte" })
      .locator("../..");
    await activeSection.getByRole("button", { name: "Filter" }).click();
    const filterPanel = activeSection.locator("div.hidden.md\\:block");
    await filterPanel
      .getByRole("combobox")
      .filter({ hasText: "Alle Kunden" })
      .click();
    await adminPage
      .getByRole("option", { name: listCustomer, exact: true })
      .click();
    await expect(visibleText(adminPage, listJobNumber)).toBeVisible();
    await expect(textInDom(adminPage, `A1-Z1-${world.runId}`)).toHaveCount(0);
    await filterPanel
      .getByRole("combobox")
      .filter({ hasText: "Alle Mitarbeiter" })
      .click();
    await adminPage.getByRole("option", { name: /Emil/ }).click();
    await expect(visibleText(adminPage, listProjectNumber)).toBeVisible();
    await jobTypeFilter(filterPanel).click();
    await adminPage
      .getByRole("option", { name: "Nur Projekte", exact: true })
      .click();
    await expect(textInDom(adminPage, listJobNumber)).toHaveCount(0);
    await expect(visibleText(adminPage, listProjectNumber)).toBeVisible();
    await activeSection
      .getByRole("button", { name: "Alle zurücksetzen" })
      .click();

    for (const heading of [
      "Nr",
      "Titel / Beschreibung",
      "Kunde",
      "Status",
      "Priorität",
      "Datum",
    ]) {
      const sortButton = visibleSortButton(activeSection, heading);
      await expect(sortButton).toBeVisible();
      await sortButton.click();
    }
    const projectRow = activeSection
      .getByRole("row")
      .filter({ hasText: listProjectNumber });
    await projectRow
      .getByRole("button", { name: "Projekt aufklappen" })
      .click();
    await expect(visibleText(adminPage, listChildNumber)).toBeVisible();
    await expect(visibleMatchingText(adminPage, /Parkplatz/)).toBeVisible();
    await expect(visibleMatchingText(adminPage, /Archiv/)).toBeVisible();

    const liveJobNumber = `A1-LIVE-${world.runId}`;
    await search.fill(liveJobNumber);
    await expect(textInDom(adminPage, liveJobNumber)).toHaveCount(0);
    await createJob(bueroPage, {
      jobNumber: liveJobNumber,
      title: `A1 Liveauftrag ${world.runId}`,
      plannedDateDigits: ownedBerlinDateAtOffset("a1-grundstock", 65)
        .split("-")
        .reverse()
        .join(""),
    });
    await expect(visibleText(adminPage, liveJobNumber)).toBeVisible({
      timeout: 30_000,
    });
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });

  test("A1-20: Auftrags-Spalten bleiben pro Nutzer wählbar [BASE-WORK-F08]", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    await createJob(adminPage, {
      jobNumber: `A1-COLUMNS-${world.runId}`,
      title: `A1 Spaltenprüfung ${world.runId}`,
      plannedDateDigits: ownedBerlinDateAtOffset("a1-grundstock", 65)
        .split("-")
        .reverse()
        .join(""),
    });
    await bueroPage.goto("/einstellungen/auftraege-projekte");
    const bueroCustomerCheckbox = bueroPage.getByRole("checkbox", {
      name: "Kunde",
      exact: true,
    });
    const bueroWasChecked = await bueroCustomerCheckbox.isChecked();

    await adminPage.goto("/einstellungen/auftraege-projekte");
    const customerCheckbox = adminPage.getByRole("checkbox", {
      name: "Kunde",
      exact: true,
    });
    const wasChecked = await customerCheckbox.isChecked();
    await customerCheckbox.click();
    await adminPage.getByRole("button", { name: "Ansicht speichern" }).click();
    await expect(
      visibleText(adminPage, "Deine Aufträge-Spalten wurden gespeichert."),
    ).toBeVisible();
    await adminPage.goto("/auftraege");
    const adminCustomerColumn = adminPage
      .getByRole("heading", { name: "Aktuelle Aufträge und Projekte" })
      .locator("../..")
      .getByRole("columnheader", { name: "Kunde" });
    if (wasChecked) {
      await expect(adminCustomerColumn).toHaveCount(0);
    } else {
      await expect(adminCustomerColumn).toBeVisible();
    }

    await bueroPage.reload();
    await expect(bueroCustomerCheckbox).toBeChecked({
      checked: bueroWasChecked,
    });
    await bueroPage.goto("/auftraege");
    const bueroCustomerColumn = bueroPage
      .getByRole("heading", { name: "Aktuelle Aufträge und Projekte" })
      .locator("../..")
      .getByRole("columnheader", { name: /Kunde/ });
    if (bueroWasChecked) {
      await expect(bueroCustomerColumn).toBeVisible();
    } else {
      await expect(bueroCustomerColumn).toHaveCount(0);
    }

    await adminPage.goto("/einstellungen/auftraege-projekte");
    await adminPage
      .getByRole("checkbox", { name: "Kunde", exact: true })
      .click();
    await adminPage.getByRole("button", { name: "Ansicht speichern" }).click();
  });

  test("A1-21/A1-24: Kalenderansichten und getrennte Plan-/Arbeitszeitfilter", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const title = `A1 Kalender ${world.runId}`;
    const otherEmployeeTitle = `A1 Kalender Bruno ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: "internal",
      internalTitle: title,
      date: ownedBerlinDateAtOffset("a1-grundstock", 20),
      time: "06:00",
      durationHours: 1,
      employeeNames: ["Emil"],
      overrideReason: "A1 Audit ohne hinterlegten Wochenplan",
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: "internal",
      internalTitle: otherEmployeeTitle,
      date: ownedBerlinDateAtOffset("a1-grundstock", 20),
      time: "08:00",
      durationHours: 1,
      employeeNames: ["Bruno"],
      overrideReason: "A1 Organisationssicht ohne hinterlegten Wochenplan",
    });
    await adminPage.goto("/kalender");
    for (const view of ["Tag", "Woche", "Monat"]) {
      await adminPage.getByRole("tab", { name: view, exact: true }).click();
      await expect(
        adminPage.getByRole("tab", { name: view, exact: true }),
      ).toHaveAttribute("data-state", "active");
    }
    const planningDate = ownedBerlinDateAtOffset("a1-grundstock", 20);
    await showPlanningMonth(adminPage, planningDate);
    await adminPage.getByRole("button", { name: "Aktualisieren" }).click();
    const targetDay = calendarDay(adminPage, planningDate);
    const calendarEvent = targetDay
      .locator(".fc-event-job")
      .filter({ hasText: title });
    await expect(calendarEvent).toHaveCount(1, { timeout: 20_000 });
    const calendarTitle = visibleText(adminPage, title);
    if (!(await calendarTitle.isVisible().catch(() => false))) {
      await targetDay.getByText(/\+\d+ mehr/).click({ timeout: 5_000 });
    }
    await expect(calendarTitle).toBeVisible({ timeout: 20_000 });
    await expect(visibleText(adminPage, otherEmployeeTitle)).toBeVisible();
    const calendarMain = adminPage.getByRole("main");
    await expect(
      calendarMain.getByText("Arbeitszeiten", { exact: true }),
    ).toBeVisible();
    await expect(
      calendarMain.getByText("Aufträge", { exact: true }),
    ).toBeVisible();
    await calendarMain.getByText("Aufträge", { exact: true }).click();
    await expect(textInDom(adminPage, title)).toHaveCount(0);
    await calendarMain.getByText("Aufträge", { exact: true }).click();
    await expect(visibleText(adminPage, title)).toBeVisible();
    await calendarMain.getByRole("button", { name: /Mitarbeiter/ }).click();
    await adminPage.getByRole("button", { name: "Keine auswählen" }).click();
    await adminPage.getByRole("button", { name: /Emil/ }).click();
    await adminPage.keyboard.press("Escape");
    await expect(visibleText(adminPage, title)).toBeVisible();
    await expect(textInDom(adminPage, otherEmployeeTitle)).toHaveCount(0);

    await showPlanningMonth(employeePage, planningDate);
    await expect(visibleText(employeePage, title)).toBeVisible({
      timeout: 20_000,
    });
    await expect(textInDom(employeePage, otherEmployeeTitle)).toHaveCount(0);
    for (const view of ["Tag", "Woche", "Monat"]) {
      await employeePage.getByRole("tab", { name: view, exact: true }).click();
      await expect(
        employeePage.getByRole("tab", { name: view, exact: true }),
      ).toHaveAttribute("data-state", "active");
    }
  });

  test("A1-22: Kalender-Drag verschiebt Planung erst nach bestätigtem Warnpfad", async ({
    adminPage,
    world,
  }) => {
    const sourceDate = ownedBerlinDateAtOffset("a1-grundstock", 22);
    const targetDate = ownedBerlinDateAtOffset("a1-grundstock", 23);
    const title = `A1 Drag ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: "internal",
      internalTitle: title,
      date: sourceDate,
      time: "06:00",
      durationHours: 1,
      employeeNames: ["Emil"],
      overrideReason: "A1 Ausgangsplanung ohne Wochenplan",
    });
    await adminPage.reload();
    await showPlanningMonth(adminPage, sourceDate);
    const event = calendarJobEvent(adminPage, title);
    const targetCell = calendarDay(adminPage, targetDate);
    await event.dragTo(targetCell);
    const warning = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Planungshinweise prüfen" }),
    });
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await warning
      .locator("#planning-warning-reason")
      .fill("A1 Drag bewusst bestätigt");
    await warning
      .getByRole("button", { name: "Mit Begründung speichern" })
      .click();
    await expect(warning).toHaveCount(0, { timeout: 20_000 });
    await showPlanningMonth(adminPage, targetDate);
    await expect(
      calendarDayJobEvent(adminPage, targetDate, title),
    ).toBeVisible();
  });

  test("A1-23: Kalender erstellt, skaliert, hängt um und parkt per Drag & Drop [BASE-CALENDAR-F02]", async ({
    adminPage,
    world,
  }) => {
    const plannedDate = ownedBerlinDateAtOffset("a1-grundstock", 65);
    const jobNumber = `A1-CAL-J-${world.runId}`;
    const title = `A1 Kalenderauftrag ${world.runId}`;
    await adminPage.goto("/kalender");
    await adminPage.getByRole("button", { name: "Kalendereintrag" }).click();
    const createDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", {
        name: "Kalendereintrag erstellen",
      }),
    });
    await createDialog.getByRole("tab", { name: "Auftrag erstellen" }).click();
    await createDialog.locator("#job-number").fill(jobNumber);
    await createDialog.locator("#job-title").fill(title);
    await typeIntoDatePicker(
      createDialog,
      "Datum",
      plannedDate.split("-").reverse().join(""),
    );
    await typeIntoTimeInput(createDialog, "job-time", "0900");
    await createDialog.locator("#job-duration").fill("1");
    await createDialog
      .getByRole("combobox")
      .filter({ hasText: "Mitarbeiter zuweisen" })
      .click();
    await adminPage.getByPlaceholder("Mitarbeiter suchen...").fill("Emil");
    await adminPage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: "Emil" })
      .click();
    await createDialog
      .getByRole("heading", { name: "Kalendereintrag erstellen" })
      .click();
    await createDialog
      .getByRole("button", { name: "Auftrag erstellen", exact: true })
      .click();
    await confirmPlanningWarning(
      adminPage,
      "A1 Kalenderauftrag bewusst geplant",
      false,
    );
    await expect(createDialog).toHaveCount(0, { timeout: 20_000 });

    await showPlanningMonth(adminPage, plannedDate);
    await calendarDay(adminPage, plannedDate).click();
    await expect(
      adminPage.getByRole("tab", { name: "Tag", exact: true }),
    ).toHaveAttribute("data-state", "active");
    const jobBlock = dayViewJobBlock(adminPage, title);
    await expect(jobBlock).toBeVisible({ timeout: 20_000 });
    const widthBefore = (await jobBlock.boundingBox())?.width ?? 0;
    const rightHandle = jobBlock.locator("div.absolute.right-0");
    const handleBox = await rightHandle.boundingBox();
    if (!handleBox) throw new Error("A1-23 resize handle has no bounding box");
    await adminPage.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await adminPage.mouse.down();
    await adminPage.mouse.move(
      handleBox.x + handleBox.width / 2 + 60,
      handleBox.y + handleBox.height / 2,
      {
        steps: 12,
      },
    );
    await adminPage.mouse.up();
    await confirmPlanningWarning(adminPage, "A1 Dauer bewusst verlängert");
    await expect
      .poll(async () => (await jobBlock.boundingBox())?.width ?? 0)
      .toBeGreaterThan(widthBefore + 30);

    let blockBox = await jobBlock.boundingBox();
    if (!blockBox) throw new Error("A1-23 job block has no bounding box");
    await adminPage.mouse.move(
      blockBox.x + blockBox.width / 2,
      blockBox.y + blockBox.height / 2,
    );
    await adminPage.mouse.down();
    await adminPage.mouse.move(
      blockBox.x + blockBox.width / 2,
      blockBox.y - 72,
      { steps: 12 },
    );
    await adminPage.mouse.up();
    await confirmPlanningWarning(
      adminPage,
      "A1 Umplanung zu Bruno bewusst bestätigt",
    );
    await expect(
      visibleText(
        adminPage,
        `Auftrag wurde zu ${world.users.buero.firstName} ${world.users.buero.lastName} verschoben.`,
      ),
    ).toBeVisible({ timeout: 20_000 });

    blockBox = await jobBlock.boundingBox();
    const parkplatzButton = adminPage.getByRole("button", {
      name: /Parkplatz/,
    });
    const parkplatzBox = await parkplatzButton.boundingBox();
    if (!blockBox || !parkplatzBox)
      throw new Error("A1-23 park drag targets are unavailable");
    await adminPage.mouse.move(
      blockBox.x + blockBox.width / 2,
      blockBox.y + blockBox.height / 2,
    );
    await adminPage.mouse.down();
    await adminPage.mouse.move(
      parkplatzBox.x + parkplatzBox.width / 2,
      parkplatzBox.y + parkplatzBox.height / 2,
      { steps: 15 },
    );
    await adminPage.mouse.up();
    const parkingContextDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Parkplatz-Kontext" }),
    });
    await expect(parkingContextDialog).toBeVisible({ timeout: 20_000 });
    await parkingContextDialog.locator("#parking-reason").click();
    await adminPage
      .getByRole("option", { name: "Kapazität", exact: true })
      .click();
    await parkingContextDialog
      .locator("#parking-note")
      .fill("A1 Auftrag wird bis zur neuen Kapazitätsplanung geparkt.");
    await selectFromSearchable(
      adminPage,
      parkingContextDialog.locator("#parking-responsible"),
      world.users.admin.firstName,
    );
    await typeIntoDatePicker(
      parkingContextDialog,
      "Wiedervorlagedatum",
      berlinDateAtOffset(7).split("-").reverse().join(""),
    );
    await parkingContextDialog
      .getByRole("button", { name: "Kontext speichern" })
      .click();
    await expect(parkingContextDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(visibleText(adminPage, "Auftrag wurde geparkt.")).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.reload();
    await showPlanningMonth(adminPage, plannedDate);
    await calendarDay(adminPage, plannedDate).click();
    await parkplatzButton.click();
    const parkedPill = parkedJobPill(adminPage, title);
    await expect(parkedPill).toBeVisible();
    await expect(parkedPill.locator("[data-parking-context]")).toHaveAttribute(
      "data-parking-context",
      "set",
      { timeout: 20_000 },
    );
    const timeline = calendarTimeline(adminPage);
    await parkedPill.dragTo(timeline, { targetPosition: { x: 620, y: 105 } });
    await confirmPlanningWarning(
      adminPage,
      "A1 Auftrag aus Parkplatz eingeplant",
      false,
    );
    await expect(
      visibleText(adminPage, "Auftrag wurde eingeplant."),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(parkedPill).toHaveCount(0, { timeout: 20_000 });
    await expect(dayViewJobBlock(adminPage, title)).toBeVisible();
  });

  test("A1-29: Manuelle Zeiten lehnen falsche Reihenfolge und Überlappung ab", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const completedBusinessDate = berlinDateAtOffset(0);
    const digits = completedBusinessDate.split("-").reverse().join("");
    const invalidOrderDigits = berlinDateAtOffset(-1)
      .split("-")
      .reverse()
      .join("");
    const manualTimeJobNumber = `A1-MANUAL-${world.runId}`;
    const manualTimeJobTitle = `A1 Manueller Zeitauftrag ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: manualTimeJobNumber,
      title: manualTimeJobTitle,
      assignEmployeeName: "Emil",
    });
    await employeePage.goto("/zeiterfassung");
    await employeePage
      .getByRole("button", { name: "Manuelle Eintragung" })
      .click();
    let dialog = employeePage.getByRole("dialog");
    await typeIntoDatePicker(dialog, "Datum", invalidOrderDigits);
    await typeIntoTimeInput(dialog, "clockInTime", "0900");
    await typeIntoTimeInput(dialog, "clockOutTime", "0800");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "Die Einstempelzeit muss vor der Ausstempelzeit liegen.",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Schließen" }).click();

    await employeePage
      .getByRole("button", { name: "Manuelle Eintragung" })
      .click();
    dialog = employeePage.getByRole("dialog");
    await dialog
      .getByRole("combobox")
      .filter({ hasText: "Kein Auftrag" })
      .click();
    await employeePage
      .getByPlaceholder("Auftrag suchen...")
      .fill(manualTimeJobNumber);
    await employeePage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: manualTimeJobNumber })
      .click();
    await typeIntoDatePicker(dialog, "Datum", digits);
    await typeIntoTimeInput(dialog, "clockInTime", "0000");
    await typeIntoTimeInput(dialog, "clockOutTime", "0005");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    // Close-then-banner (M5): the dialog closes and the global banner confirms.
    await expect(
      visibleText(employeePage, "Antrag wurde zur Genehmigung eingereicht."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    await employeePage
      .getByRole("button", { name: "Manuelle Eintragung" })
      .click();
    dialog = employeePage.getByRole("dialog");
    await typeIntoDatePicker(dialog, "Datum", digits);
    await typeIntoTimeInput(dialog, "clockInTime", "0002");
    await typeIntoTimeInput(dialog, "clockOutTime", "0004");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(dialog.getByText(/überschneidet|Überlappung/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("A1-24/A1-25: Kalender-Zeiteintrag, Blocktrennung, Pending-Dialog, Filter und Realtime [BASE-CALENDAR-F03/F04]", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const manualTimeState = await findLatestManualTimeEntryState(
      world.orgId,
      world.users.employee.id,
    );
    requireSerialPrecondition(manualTimeState?.status === "pending", {
      test: "A1-24/A1-25",
      needs: "the pending manual time entry created by A1-29",
      grep: "A1-29|A1-24/A1-25",
      suite: "audit",
    });
    const manualTimeJobTitle = `A1 Manueller Zeitauftrag ${world.runId}`;
    const today = berlinDateAtOffset(0);
    const plannedTitle = `A1 Kalender Planarbeit ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: "internal",
      internalTitle: plannedTitle,
      date: today,
      time: "10:00",
      durationHours: 1,
      employeeNames: ["Bruno"],
      overrideReason: "A1 heutige Planarbeit für Kalendertrennung",
    });

    await openTimeApprovals(adminPage);
    const pendingPair = adminPage
      .getByTestId(/pending-session-/)
      .filter({ hasText: world.users.employee.firstName });
    await expect(pendingPair).toContainText(/00:00.*00:05/);
    await expect(pendingPair).toContainText(manualTimeJobTitle);

    await adminPage.goto("/kalender");
    await adminPage.getByRole("button", { name: "Kalendereintrag" }).click();
    const manualDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", {
        name: "Kalendereintrag erstellen",
      }),
    });
    await manualDialog
      .getByRole("tab", { name: "Manuelle Eintragung" })
      .click();
    await manualDialog.locator("#manual-entry-member").click();
    await adminPage.getByPlaceholder("Mitarbeiter suchen...").fill("Bruno");
    await adminPage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: "Bruno" })
      .click();
    await typeIntoTimeInput(manualDialog, "clockInTime", "0010");
    await typeIntoTimeInput(manualDialog, "clockOutTime", "0015");
    await manualDialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      visibleText(adminPage, "Eintrag erfolgreich erstellt!"),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(manualDialog).toHaveCount(0, { timeout: 10_000 });

    await adminPage.getByRole("tab", { name: "Tag", exact: true }).click();
    const refreshButton = adminPage.getByRole("button", {
      name: "Aktualisieren",
    });
    await refreshButton.click();
    await expect(refreshButton).toBeDisabled();
    await expect(refreshButton).toBeEnabled({ timeout: 30_000 });
    await visibleText(adminPage, "Arbeitszeiten").click();
    const plannedBlock = dayViewJobBlock(adminPage, plannedTitle);
    const workBlock = visibleCalendarTimeBlock(adminPage, /00:10.*00:15/);
    await expect(plannedBlock).toBeVisible({ timeout: 20_000 });
    await expect(workBlock).toBeVisible({ timeout: 20_000 });
    const calendarMain = adminPage.getByRole("main");
    await calendarMain.getByText("Aufträge", { exact: true }).click();
    await expect(plannedBlock).toHaveCount(0);
    await expect(workBlock).toBeVisible();
    await calendarMain.getByText("Aufträge", { exact: true }).click();
    await visibleText(adminPage, "Arbeitszeiten").click();
    await expect(adminPage.getByTitle(/00:10.*00:15/)).toHaveCount(0);
    await expect(dayViewJobBlock(adminPage, plannedTitle)).toBeVisible();
    await visibleText(adminPage, "Arbeitszeiten").click();

    const pendingBlock = visibleCalendarTimeBlock(adminPage, /00:00.*00:05/);
    await expect(pendingBlock).toBeVisible({ timeout: 20_000 });
    await expect(pendingBlock).toHaveClass(/bg-yellow-/);
    await pendingBlock.getByRole("button").click();
    await expect(
      adminPage.getByRole("dialog").filter({
        has: adminPage.getByRole("heading", { name: "Eintrag Details" }),
      }),
    ).toBeVisible();
    await adminPage.keyboard.press("Escape");

    await showPlanningMonth(adminPage, today);
    const liveTitle = `A1 Kalender Live ${world.runId}`;
    await createPlannedCalendarEntry(bueroPage, {
      kind: "internal",
      internalTitle: liveTitle,
      date: today,
      time: "12:00",
      durationHours: 1,
      employeeNames: ["Bruno"],
      overrideReason: "A1 Kalender-Realtime",
    });
    await expect(visibleText(adminPage, liveTitle)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("A1-30: Manager korrigiert, hängt um und löscht bestehende Arbeitsblöcke", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const completedBusinessDate = berlinDateAtOffset(-1);
    const digits = completedBusinessDate.split("-").reverse().join("");
    await createOwnManualTimeEntry(employeePage, {
      dateDigits: digits,
      clockInDigits: "1000",
      clockOutDigits: "1100",
    });
    await openTimeApprovals(adminPage);
    await approvePendingTimeEntry(
      adminPage,
      world.users.employee.id,
      /10:00.*11:00/,
    );

    await adminPage.goto("/kalender");
    await adminPage.getByRole("tab", { name: "Tag", exact: true }).click();
    await adminPage.getByRole("button", { name: "Zurück" }).click();
    await visibleText(adminPage, "Arbeitszeiten").click();
    await adminPage.getByRole("button", { name: "Aktualisieren" }).click();
    const workBlock = visibleCalendarTimeBlock(adminPage, /10:00.*11:00/);
    await expect(workBlock).toBeVisible({ timeout: 20_000 });
    await workBlock.click();
    let dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Eintrag Details" }),
    });
    await dialog
      .getByRole("button", { name: "Bearbeiten", exact: true })
      .click({ delay: 250 });
    const clockOutTime = clockOutTimeGroup(dialog);
    await clockOutTime.focus();
    await clockOutTime.press("ArrowLeft");
    await clockOutTime.press("Delete");
    await clockOutTime.pressSequentially("11", { delay: 50 });
    await clockOutTime.press("ArrowRight");
    await clockOutTime.press("Delete");
    await clockOutTime.pressSequentially("30", { delay: 50 });
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Bearbeiten", exact: true }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.keyboard.press("Escape");
    await expect(
      visibleCalendarTimeBlock(adminPage, /10:00.*11:30/),
    ).toBeVisible({
      timeout: 20_000,
    });

    const source = visibleCalendarTimeBlock(
      adminPage,
      /10:00.*11:30/,
    ).getByRole("button");
    const sourceBox = await source.boundingBox();
    if (!sourceBox)
      throw new Error("A1-30 source work block has no bounding box");
    await adminPage.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await adminPage.mouse.down();
    await adminPage.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y - 72,
      { steps: 12 },
    );
    await adminPage.mouse.up();
    await expect(
      visibleText(
        adminPage,
        `Zeiteintrag wurde zu ${world.users.buero.firstName} ${world.users.buero.lastName} verschoben.`,
      ),
    ).toBeVisible({
      timeout: 20_000,
    });

    await visibleCalendarTimeBlock(adminPage, /10:00.*11:30/).click();
    dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Eintrag Details" }),
    });
    await dialog.getByRole("button", { name: "Löschen", exact: true }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Löschen", exact: true })
      .click();
    await expect(adminPage.getByTitle(/10:00.*11:30/)).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("A1-31: Verlauf filtert Zeitraum, Mitarbeiter und Status [BASE-TIME-F06]", async ({
    adminPage,
    world,
  }) => {
    const inheritedTimeEntries = await getOrganizationTimeEntrySnapshot(
      world.orgId,
    );
    requireSerialPrecondition(
      inheritedTimeEntries.some(
        (entry) =>
          entry.user_id === world.users.employee.id &&
          entry.status === "pending" &&
          entry.is_manual === true,
      ),
      {
        test: "A1-31",
        needs: "the pending manual time entry created by A1-29",
        grep: "A1-29|A1-31",
        suite: "audit",
      },
    );
    await adminPage.goto("/zeiterfassung");
    await adminPage
      .getByRole("button", { name: "Manuelle Eintragung" })
      .click();
    const manualDialog = adminPage.getByRole("dialog");
    await manualDialog.locator("#manual-entry-member").click();
    await adminPage.getByPlaceholder("Mitarbeiter suchen...").fill("Emil");
    await adminPage
      .getByRole("listbox")
      .getByRole("button")
      .filter({ hasText: "Emil" })
      .click();
    const todayDigits = berlinDateAtOffset(0).split("-").reverse().join("");
    await typeIntoDatePicker(manualDialog, "Datum", todayDigits);
    await typeIntoTimeInput(manualDialog, "clockInTime", "0010");
    await typeIntoTimeInput(manualDialog, "clockOutTime", "0015");
    await manualDialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      visibleText(adminPage, "Eintrag erfolgreich erstellt!"),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(manualDialog).toHaveCount(0, { timeout: 10_000 });

    await adminPage.getByRole("tab", { name: "Verlauf" }).click();
    const history = adminPage.getByRole("tabpanel", { name: "Verlauf" });
    await expect(history.getByText(/Einträge? gefunden/)).toBeVisible({
      timeout: 20_000,
    });
    const filters = history.getByRole("combobox");
    await selectFromSearchable(
      adminPage,
      filters.filter({ hasText: "Alle Mitarbeiter" }),
      "Emil",
    );
    await filters.filter({ hasText: "Alle" }).click();
    await adminPage
      .getByRole("option", { name: "Ausstehend", exact: true })
      .click();
    await history.getByRole("button", { name: "Laden" }).click();
    const pendingRows = history.locator("tbody tr");
    await expect(pendingRows).toHaveCount(2, { timeout: 20_000 });
    for (const row of await pendingRows.all()) {
      await expect(row).toContainText("Emil");
      await expect(row).toContainText("Ausstehend");
    }

    const fromDate = history.getByText("Von", { exact: true }).locator("..");
    const toDate = history.getByText("Bis", { exact: true }).locator("..");
    await typeIntoDatePicker(fromDate, "Datum", todayDigits);
    await typeIntoDatePicker(toDate, "Datum", todayDigits);
    await history.getByRole("button", { name: "Laden" }).click();
    await expect(pendingRows).toHaveCount(2, { timeout: 20_000 });

    await filters.filter({ hasText: "Ausstehend" }).click();
    await adminPage
      .getByRole("option", { name: "Genehmigt", exact: true })
      .click();
    await history.getByRole("button", { name: "Laden" }).click();
    // Emil's live clock/break events from the A1-05 journey are approved too,
    // so the exact approved total is state-dependent. Assert this test's own
    // admin-created 00:10/00:15 pair and the filter contract on every row.
    const approvedRows = history.locator("tbody tr");
    await expect(approvedRows.filter({ hasText: /00:1[05]/ })).toHaveCount(2, {
      timeout: 20_000,
    });
    for (const row of await approvedRows.all()) {
      await expect(row).toContainText("Emil");
      await expect(row).toContainText("Genehmigt");
    }

    await selectFromSearchable(
      adminPage,
      filters.filter({ hasText: /Emil/ }),
      "Bruno",
    );
    await filters.filter({ hasText: "Genehmigt" }).click();
    await adminPage
      .getByRole("option", { name: "Ausstehend", exact: true })
      .click();
    await history.getByRole("button", { name: "Laden" }).click();
    await expect(visibleText(adminPage, "Keine Einträge gefunden")).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });

  test("A1-32: Nur Admin ändert Pausenregel und abgeschlossene Historie bleibt stabil", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const entriesBefore = await getOrganizationTimeEntrySnapshot(world.orgId);
    await adminPage.goto("/einstellungen/zeiterfassung");
    await adminPage.getByLabel("Art der Pausenbuchung").click();
    await adminPage
      .getByRole("option", { name: "Pause automatisch abziehen" })
      .click();
    // The minute fields dropped type="number" (M4 canon migration): textbox
    // role with inputMode="numeric", zod keeps the bounds.
    await adminPage
      .getByRole("textbox", { name: "Automatische Schwelle (Minuten)" })
      .fill("360");
    await adminPage
      .getByRole("textbox", { name: "Automatische Pausendauer (Minuten)" })
      .fill("30");
    await adminPage
      .getByRole("button", { name: "Zeiterfassung speichern" })
      .click();
    await expect(
      visibleText(
        adminPage,
        "Die Regeln für die Zeiterfassung wurden gespeichert.",
      ),
    ).toBeVisible();

    await bueroPage.goto("/einstellungen/zeiterfassung");
    await expect(bueroPage.getByLabel("Art der Pausenbuchung")).toBeDisabled();
    await expect(
      visibleText(
        bueroPage,
        "Du kannst diese Regeln einsehen, aber nur der Admin kann sie ändern.",
      ),
    ).toBeVisible();
    expect(await getOrganizationTimeEntrySnapshot(world.orgId)).toEqual(
      entriesBefore,
    );
  });

  test("A1-33: Stapel, Ordner, Drag & Drop und großer Upload mit echtem Fortschritt [BASE-DOCUMENT-F02/P1-00A-F01]", async ({
    adminPage,
    world,
  }) => {
    await adminPage.goto("/dokumente");
    await adminPage
      .getByRole("button", { name: "Hochladen oder Erstellen" })
      .click();
    const fileChooserPromise = adminPage.waitForEvent("filechooser");
    await adminPage
      .getByRole("menuitem", { name: "Dateien hochladen" })
      .click();
    const fileChooser = await fileChooserPromise;
    const fileInput = documentUploadInput(adminPage);
    await fileChooser.setFiles([
      {
        name: `a1-batch-a-${world.runId}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from("A1 batch file A"),
      },
      {
        name: `a1-batch-b-${world.runId}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from("A1 batch file B"),
      },
    ]);
    await expect(adminPage.getByRole("dialog")).toBeVisible();
    await expect(adminPage.getByRole("dialog")).toHaveCount(0, {
      timeout: 60_000,
    });
    await adminPage.reload();
    await expect(
      visibleText(adminPage, `a1-batch-a-${world.runId}.txt`),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      visibleText(adminPage, `a1-batch-b-${world.runId}.txt`),
    ).toBeVisible();

    await documentFolderUploadInput(adminPage).setInputFiles(
      resolve(process.cwd(), "tests/audit/fixtures/folder-upload"),
    );
    await expect(adminPage.getByRole("dialog")).toBeVisible();
    await expect(adminPage.getByRole("dialog")).toHaveCount(0, {
      timeout: 60_000,
    });
    await adminPage.reload();
    await expect(visibleText(adminPage, "folder-upload")).toBeVisible({
      timeout: 20_000,
    });

    await adminPage.evaluate((fileName) => {
      const heading = Array.from(document.querySelectorAll("h1")).find(
        (candidate) => candidate.textContent?.trim() === "Dokumente",
      );
      const target = heading?.parentElement?.parentElement?.parentElement;
      if (!target) throw new Error("Document library drop target is missing");
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["A1 external drop"], fileName, { type: "text/plain" }),
      );
      target.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }),
      );
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    }, `a1-drop-${world.runId}.txt`);
    await expect(adminPage.getByRole("dialog")).toBeVisible();
    await expect(adminPage.getByRole("dialog")).toHaveCount(0, {
      timeout: 60_000,
    });
    await adminPage.reload();
    await expect(
      visibleText(adminPage, `a1-drop-${world.runId}.txt`),
    ).toBeVisible({
      timeout: 20_000,
    });

    await adminPage.evaluate(() => {
      document.documentElement.dataset.nativeUploadProgress = "";
      document.documentElement.dataset.uploadProgressValues = "";
      document.documentElement.dataset.uploadProgressBarSeen = "false";
      const recordProgressBar = () => {
        const progressBar = document.querySelector('[role="progressbar"]');
        if (!progressBar) return;
        document.documentElement.dataset.uploadProgressBarSeen = "true";
        const value = progressBar.getAttribute("aria-valuenow");
        if (!value) return;
        const existing =
          document.documentElement.dataset.uploadProgressValues ?? "";
        document.documentElement.dataset.uploadProgressValues = `${existing},${value}`;
      };
      const progressObserver = new MutationObserver(recordProgressBar);
      progressObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["aria-valuenow"],
        childList: true,
        subtree: true,
      });
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function sendWithProgressEvidence(body) {
        this.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          const existing =
            document.documentElement.dataset.nativeUploadProgress ?? "";
          document.documentElement.dataset.nativeUploadProgress = `${existing},${event.loaded}/${event.total}`;
        });
        return originalSend.call(this, body);
      };
    });
    const networkSession = await adminPage.context().newCDPSession(adminPage);
    await networkSession.send("Network.enable");
    await networkSession.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 20,
      downloadThroughput: 10 * 1024 * 1024,
      uploadThroughput: 512 * 1024,
      connectionType: "cellular3g",
    });
    try {
      await fileInput.setInputFiles({
        name: `a1-large-${world.runId}.bin`,
        mimeType: "application/octet-stream",
        buffer: Buffer.alloc(6 * 1024 * 1024, 65),
      });
      await expect(
        adminPage.getByRole("progressbar", {
          name: "Gesamtfortschritt des Uploads",
        }),
      ).toBeVisible();
      await expect(adminPage.getByRole("dialog")).toHaveCount(0, {
        timeout: 90_000,
      });
    } finally {
      await networkSession.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await networkSession.detach();
    }
    const progressEvidence = await adminPage.evaluate(() => ({
      barSeen: document.documentElement.dataset.uploadProgressBarSeen,
      values: (document.documentElement.dataset.uploadProgressValues ?? "")
        .split(",")
        .filter(Boolean)
        .map(Number),
      nativeSamples: (
        document.documentElement.dataset.nativeUploadProgress ?? ""
      )
        .split(",")
        .filter(Boolean)
        .map((sample) => sample.split("/").map(Number)),
    }));
    expect(progressEvidence.barSeen).toBe("true");
    expect(progressEvidence.values).toContain(100);
    expect(
      progressEvidence.nativeSamples.some(
        ([, total]) => total === 6 * 1024 * 1024,
      ),
    ).toBe(true);
    expect(progressEvidence.nativeSamples.at(-1)).toEqual([
      6 * 1024 * 1024,
      6 * 1024 * 1024,
    ]);
    await adminPage.reload();
    await expect(
      visibleText(adminPage, `a1-large-${world.runId}.bin`),
    ).toBeVisible({
      timeout: 20_000,
    });
  });

  test("A1-34/A1-35: Ordner, Verschieben/Kopieren und Arbeitsverknüpfung", async ({
    adminPage,
    world,
  }) => {
    const checklistJobNumber = `A1-CHECK-${world.runId}`;
    const listProjectNumber = `A1-LIST-P-${world.runId}`;
    const listCustomerName = `A1 Listenkunde ${world.runId}`;
    requireSerialPrecondition(
      (await getJobCountByNumber(world.orgId, checklistJobNumber)) === 1,
      {
        test: "A1-34/A1-35",
        needs: "the checklist job created by A1-17/A1-18",
        grep: "A1-01/A1-07|A1-02/A1-03|A1-05/A1-26/A1-27/A1-28|A1-17/A1-18|A1-19|A1-34/A1-35",
        suite: "audit",
      },
    );
    await adminPage.goto(`/auftraege/projekt/${listProjectNumber}`);
    await requireVisiblePrecondition(visibleText(adminPage, listCustomerName), {
      test: "A1-34/A1-35",
      needs: "the list project and customer created by A1-19",
      grep: "A1-01/A1-07|A1-02/A1-03|A1-05/A1-26/A1-27/A1-28|A1-17/A1-18|A1-19|A1-34/A1-35",
      suite: "audit",
    });
    const folderName = `A1 Ordner ${world.runId}`;
    const fileName = `a1-dokument-${world.runId}.txt`;
    await adminPage.goto("/dokumente");
    await adminPage
      .getByRole("button", { name: "Hochladen oder Erstellen" })
      .click();
    await adminPage.getByRole("menuitem", { name: "Neuer Ordner" }).click();
    const folderDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Ordner erstellen" }),
    });
    await folderDialog.getByPlaceholder("Ordnername").fill(folderName);
    await folderDialog.getByRole("button", { name: "Erstellen" }).click();
    await expect(folderDialog).toHaveCount(0, { timeout: 15_000 });

    await documentUploadInput(adminPage).setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("WerkFlow A1 Dokument"),
    });
    await expect(visibleText(adminPage, "1 von 1 abgeschlossen")).toBeVisible({
      timeout: 60_000,
    });
    await closeDocumentUploadProgressDialog(adminPage);
    await expect(visibleText(adminPage, fileName)).toBeVisible({
      timeout: 20_000,
    });

    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage
      .getByRole("menuitem", { name: "Verknüpfungen verwalten" })
      .click();
    const linkDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Verknüpfungen verwalten" }),
    });
    await linkDialog
      .getByPlaceholder("Auftrag suchen...")
      .fill(checklistJobNumber);
    await linkDialog
      .getByRole("button")
      .filter({ hasText: checklistJobNumber })
      .click();
    await linkDialog.getByRole("button", { name: /Projekte/ }).click();
    await linkDialog
      .getByPlaceholder("Projekt suchen...")
      .fill(listProjectNumber);
    await linkDialog
      .getByRole("button")
      .filter({ hasText: listProjectNumber })
      .click();
    await linkDialog.getByRole("button", { name: /Kunden/ }).click();
    await linkDialog.getByPlaceholder("Kunde suchen...").fill(listCustomerName);
    await linkDialog
      .getByRole("button")
      .filter({ hasText: listCustomerName })
      .click();
    await linkDialog.getByRole("button", { name: /Mitarbeiter/ }).click();
    await linkDialog.getByPlaceholder("Mitarbeiter suchen...").fill("Emil");
    await linkDialog.getByRole("button").filter({ hasText: "Emil" }).click();
    await linkDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(linkDialog).toHaveCount(0, { timeout: 20_000 });

    // The save closes with a router refresh; under a loaded shared-world run it
    // can supersede this tab click. Navigate to the link target directly so the
    // filter assertions start from the persisted post-save view.
    await adminPage.goto("/dokumente?view=all");
    await expect(adminPage).toHaveURL(/view=all/);
    const documentSearch = adminPage.getByPlaceholder("Dokumente suchen...");
    await documentSearch.fill(fileName);
    await documentSearch.press("Enter");
    const documentRows = adminPage
      .getByRole("row")
      .filter({ hasText: fileName });
    await expect(documentRows).toHaveCount(1);
    for (const linkFilter of [
      "Aufträge",
      "Projekte",
      "Kunden",
      "Mitarbeiter",
    ]) {
      await adminPage.getByRole("button", { name: "Filter" }).click();
      await adminPage
        .getByRole("combobox", { name: "Verknüpfung filtern" })
        .click();
      await adminPage
        .getByRole("option", { name: linkFilter, exact: true })
        .click();
      await expect(documentRows).toHaveCount(1);
      await adminPage.getByRole("button", { name: "Filter" }).click();
    }
    await adminPage.getByRole("button", { name: "Filter" }).click();
    await adminPage
      .getByRole("combobox", { name: "Kategorie filtern" })
      .click();
    await adminPage
      .getByRole("option", { name: "Sonstige", exact: true })
      .click();
    await expect(documentRows).toHaveCount(1);
    await adminPage
      .getByRole("combobox", { name: "Verknüpfung filtern" })
      .click();
    await adminPage
      .getByRole("option", { name: "Alle Verknüpfungen", exact: true })
      .click();
    await documentSearch.fill("kein-a1-dokument");
    await documentSearch.press("Enter");
    await expect(documentRows).toHaveCount(0);
    await documentSearch.fill("");
    await documentSearch.press("Enter");
    // The cleared search commits asynchronously, and a late Realtime
    // router.refresh can revert the controlled input to the stale negative
    // query (observed 2026-08-28 on the fast local stack). Clearing is
    // idempotent and read-only, so re-commit it whenever the revert
    // demonstrably happened, then assert the row strictly.
    await expect
      .poll(
        async () => {
          if ((await documentRows.count()) === 1) return "row-visible";
          if ((await documentSearch.inputValue({ timeout: 10_000 })) !== "") {
            await documentSearch.fill("", { timeout: 10_000 });
            await documentSearch.press("Enter", { timeout: 10_000 });
          }
          return "pending";
        },
        { timeout: 30_000 },
      )
      .toBe("row-visible");
    await expect(documentRows).toHaveCount(1);
    // Navigate directly: the view-tab href embeds the live searchQuery state,
    // and a late Realtime router.refresh can revert that state to the stale
    // negative query mid-click, carrying the old search into the folders view.
    await adminPage.goto("/dokumente?view=folders");
    await expect(adminPage).toHaveURL(/view=folders/);
    await expect(visibleText(adminPage, folderName)).toBeVisible();

    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage.getByRole("menuitem", { name: "Kopieren" }).click();
    let destination = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Kopieren nach" }),
    });
    await destination.getByRole("button", { name: folderName }).click();
    await destination.getByRole("button", { name: "Hierhin kopieren" }).click();
    await expect(destination).toHaveCount(0, { timeout: 20_000 });

    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage.getByRole("menuitem", { name: "Verschieben" }).click();
    destination = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Verschieben nach" }),
    });
    await destination.getByRole("button", { name: folderName }).click();
    await destination
      .getByRole("button", { name: "Hierhin verschieben" })
      .click();
    await expect(destination).toHaveCount(0, { timeout: 20_000 });
  });

  test("A1-36/A1-37: Papierkorb, Wiederherstellung, endgültiges Löschen, Version und Verlauf", async ({
    adminPage,
    world,
  }) => {
    const fileName = `a1-version-${world.runId}.pdf`;
    await adminPage.goto("/dokumente");
    await adminPage
      .getByRole("button", { name: "Hochladen oder Erstellen" })
      .click();
    const fileChooserPromise = adminPage.waitForEvent("filechooser");
    await adminPage
      .getByRole("menuitem", { name: "Dateien hochladen" })
      .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nWerkFlow A1 Version 1"),
    });
    await expect(visibleText(adminPage, "1 von 1 abgeschlossen")).toBeVisible({
      timeout: 60_000,
    });
    await closeDocumentUploadProgressDialog(adminPage);
    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage.getByRole("menuitem", { name: "Details" }).click();
    const details = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Dateidetails" }),
    });
    await expect(details.getByText("Hochgeladen", { exact: true })).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    // The category control moved off the native <select> (M5 canon): shadcn
    // Select trigger plus role=option entries.
    await details
      .getByRole("combobox", { name: "Kategorie der Datei" })
      .click();
    await adminPage
      .getByRole("option", { name: "Verträge", exact: true })
      .click();
    await expect(
      details.getByRole("combobox", { name: "Kategorie der Datei" }),
    ).toContainText("Verträge");
    await adminPage.keyboard.press("Escape");
    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage.getByRole("menuitem", { name: "Details" }).click();
    await expect(
      details.getByText("Kategorie geändert", { exact: true }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      details.getByRole("button", { name: "Neue Version" }),
    ).toBeVisible();
    await details.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nWerkFlow A1 Version 2"),
    });
    await expect(
      visibleText(adminPage, "Neue Version wurde hochgeladen."),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(details.getByText("Aktuelle Version 2")).toBeVisible();
    await expect(details.getByText("Neue Version hochgeladen")).toBeVisible();
    await adminPage.keyboard.press("Escape");
    await expect(details).toHaveCount(0);

    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage.getByRole("menuitem", { name: "Löschen" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Datei löschen" })
      .click();
    await adminPage.getByRole("button", { name: "Papierkorb" }).click();
    await expect(visibleText(adminPage, fileName)).toBeVisible({
      timeout: 20_000,
    });
    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage.getByRole("menuitem", { name: "Wiederherstellen" }).click();
    await expect(
      visibleText(adminPage, "Datei wurde wiederhergestellt."),
    ).toBeVisible();

    await adminPage.getByRole("button", { name: "Papierkorb" }).click();
    await adminPage.goto("/dokumente");
    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage.getByRole("menuitem", { name: "Löschen" }).click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Datei löschen" })
      .click();
    await adminPage.getByRole("button", { name: "Papierkorb" }).click();
    await adminPage
      .getByRole("button", { name: `Dateiaktionen für ${fileName} öffnen` })
      .click();
    await adminPage
      .getByRole("menuitem", { name: "Endgültig löschen" })
      .click();
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Endgültig löschen" })
      .click();
    await expect(textInDom(adminPage, fileName)).toHaveCount(0);

    await adminPage.goto("/dokumente");
    await adminPage
      .getByRole("button", { name: "Hochladen oder Erstellen" })
      .click();
    const viewerFileChooserPromise = adminPage.waitForEvent("filechooser");
    await adminPage
      .getByRole("menuitem", { name: "Dateien hochladen" })
      .click();
    const viewerFileChooser = await viewerFileChooserPromise;
    const imageViewerFile = `a1-viewer-${world.runId}.png`;
    const pdfViewerFile = `a1-viewer-${world.runId}.pdf`;
    await viewerFileChooser.setFiles([
      {
        name: imageViewerFile,
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      },
      {
        name: pdfViewerFile,
        mimeType: "application/pdf",
        buffer: Buffer.from(
          "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
        ),
      },
    ]);
    await expect(visibleText(adminPage, "2 von 2 abgeschlossen")).toBeVisible({
      timeout: 60_000,
    });
    await closeDocumentUploadProgressDialog(adminPage);
    await visibleText(adminPage, imageViewerFile).click();
    let viewer = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: imageViewerFile }),
    });
    const imagePreview = viewer.getByRole("img", { name: imageViewerFile });
    await expect(imagePreview).toBeVisible({ timeout: 20_000 });
    await expect(
      viewer.getByRole("link", { name: "Neuer Tab" }),
    ).toHaveAttribute("href", /^https?:\/\/.+X-Amz-(Algorithm|Signature)=/);
    await expectSignedWindowOpen(adminPage, () =>
      viewer.getByRole("button", { name: "Herunterladen" }).click(),
    );
    await adminPage.keyboard.press("Escape");

    await visibleText(adminPage, pdfViewerFile).click();
    viewer = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: pdfViewerFile }),
    });
    await expect(viewer.getByTitle(pdfViewerFile)).toHaveAttribute(
      "src",
      /^https?:\/\/.+X-Amz-(Algorithm|Signature)=.+#toolbar=0/,
    );
  });

  test("A1-38: Handwerker lädt am zugewiesenen Auftrag hoch, öffnet und lädt signiert herunter [BASE-DOCUMENT-F04/P1-00A-F02]", async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const assignedJobNumber = `A1-DOC-E-${world.runId}`;
    const unassignedJobNumber = `A1-DOC-X-${world.runId}`;
    const fileName = `a1-employee-${world.runId}.png`;
    await createJob(adminPage, {
      jobNumber: assignedJobNumber,
      title: `A1 Mitarbeiterdokument ${world.runId}`,
      assignEmployeeName: "Emil",
    });
    await createJob(adminPage, {
      jobNumber: unassignedJobNumber,
      title: `A1 Nicht zugewiesen ${world.runId}`,
    });

    await expectRedirectedAway(employeePage, "/dokumente");
    await employeePage.goto(`/auftraege/${assignedJobNumber}`);
    const documentsSection = employeePage
      .getByRole("heading", { name: "Dokumente & Bilder" })
      .locator('xpath=ancestor::div[contains(@class, "bg-card")][1]');
    await documentsSection.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    // A tiny upload can finish before a visibility poll ever sees the
    // progress dialog (transient-flash class, testing.md); the close-wait plus
    // the persisted file row below are the honest proof.
    await expect(employeePage.getByRole("dialog")).toHaveCount(0, {
      timeout: 60_000,
    });
    await employeePage.reload();
    await employeePage
      .getByRole("button", { name: new RegExp(fileName) })
      .click();
    const viewer = employeePage.getByRole("dialog").filter({
      has: employeePage.getByRole("heading", { name: fileName }),
    });
    await expect(viewer.getByRole("img", { name: fileName })).toBeVisible({
      timeout: 20_000,
    });
    await expectSignedWindowOpen(employeePage, () =>
      viewer.getByRole("button", { name: "Herunterladen" }).click(),
    );
    await employeePage.keyboard.press("Escape");
    await expectRedirectedAway(
      employeePage,
      `/auftraege/${unassignedJobNumber}`,
    );

    const liveFileName = `a1-doc-live-${world.runId}.txt`;
    await adminPage.goto("/dokumente?view=all");
    await bueroPage.goto("/dokumente");
    const uploadDialog = bueroPage.getByRole("dialog").filter({
      has: bueroPage.getByRole("heading", { name: "Dateien hochladen" }),
    });
    // Right after navigation the file input can receive the files before
    // hydration attaches its change handler, so nothing opens (pre-hydration
    // class; surfaced by the fast local stack 2026-08-28). Wait for hydration
    // like the login helper does; no dialog means no upload started, so
    // re-selecting the files is safe.
    await bueroPage.waitForLoadState("networkidle");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await documentUploadInput(bueroPage).setInputFiles(
        {
          name: liveFileName,
          mimeType: "text/plain",
          buffer: Buffer.from("A1 document Realtime"),
        },
        { timeout: 15_000 },
      );
      const opened = await uploadDialog
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (opened) break;
      if (attempt === 3) {
        throw new Error(
          "Upload dialog did not open after three file selections.",
        );
      }
    }
    await expect(uploadDialog).toHaveCount(0, { timeout: 60_000 });
    await expect(visibleText(bueroPage, liveFileName)).toBeVisible({
      timeout: 15_000,
    });
    // The admin channel can still be subscribing when the INSERT fires right
    // after navigation (missed-delivery class); the sanctioned one-reload
    // fallback keeps the persisted-row assertion strict while GG-00's
    // dedicated Realtime test remains the freshness guard.
    await expectVisibleAfterSave(adminPage, liveFileName);
  });

  test("A1-40/A1-44: Artikel und Lager per UI sowie alle Inventaransichten", async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const inventoryLocationName = `A1 Lager ${world.runId}`;
    const inventoryItemName = `A1 Artikel ${world.runId}`;
    await createInventoryLocation(adminPage, inventoryLocationName);
    await createInventoryItem(adminPage, {
      name: inventoryItemName,
      locationName: inventoryLocationName,
      initialQuantity: 5,
      supplierName: `A1 Lieferant ${world.runId}`,
    });
    await adminPage.goto("/inventar");
    const row = adminPage
      .getByRole("row")
      .filter({ hasText: inventoryItemName });
    await row.getByRole("button", { name: "Aktionen", exact: true }).click();
    await adminPage.getByRole("menuitem", { name: "Bearbeiten" }).click();
    let itemDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Artikel bearbeiten" }),
    });
    await itemDialog.locator("#inventory-item-type").click();
    for (const type of [
      "Material",
      "Verbrauchsmaterial",
      "Werkzeug",
      "Gerät / Anlage",
    ]) {
      await expect(
        adminPage.getByRole("option", { name: type, exact: true }),
      ).toBeVisible();
    }
    await adminPage
      .getByRole("option", { name: "Material", exact: true })
      .click();
    await itemDialog.locator("#inventory-item-unit").click();
    await adminPage.getByRole("option", { name: "Meter", exact: true }).click();
    await itemDialog
      .locator("#inventory-item-internal-sku")
      .fill(`SKU-${world.runId}`);
    await itemDialog
      .locator("#inventory-item-barcode")
      .fill(`400${world.runId.replace(/\D/g, "").slice(-10)}`);
    await itemDialog
      .locator("#inventory-item-manufacturer")
      .fill("WerkFlow Prüfhersteller");
    await itemDialog
      .locator("#inventory-item-supplier-number")
      .fill(`LIEF-${world.runId}`);
    await itemDialog.locator("#inventory-item-minimum-stock").fill("2");
    await itemDialog.locator("#inventory-item-target-stock").fill("12");
    await itemDialog.locator("#inventory-item-purchase-price").fill("12,50");
    await itemDialog.locator("#inventory-item-sale-price").fill("24,90");
    await itemDialog
      .locator("#inventory-item-description")
      .fill("A1 vollständige Artikelbeschreibung");
    await itemDialog.locator("#inventory-item-notes").fill("A1 interne Notiz");
    const billableCheckbox = itemDialog.getByRole("checkbox", {
      name: "Abrechenbar",
    });
    if (!(await billableCheckbox.isChecked())) await billableCheckbox.click();
    await itemDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(itemDialog).toHaveCount(0, { timeout: 20_000 });

    for (const [suffix, type] of [
      ["V", "Verbrauchsmaterial"],
      ["W", "Werkzeug"],
      ["G", "Gerät / Anlage"],
    ] as const) {
      await adminPage
        .getByRole("button", { name: "Artikel", exact: true })
        .click();
      itemDialog = adminPage.getByRole("dialog").filter({
        has: adminPage.getByRole("heading", { name: "Artikel anlegen" }),
      });
      await itemDialog
        .locator("#inventory-item-name")
        .fill(`A1 Typ ${suffix} ${world.runId}`);
      await itemDialog.locator("#inventory-item-type").click();
      await adminPage.getByRole("option", { name: type, exact: true }).click();
      await itemDialog.getByRole("button", { name: "Speichern" }).click();
      await expect(itemDialog).toHaveCount(0, { timeout: 20_000 });
    }

    await adminPage.getByRole("button", { name: "Lager", exact: true }).click();
    const locationDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Lager anlegen" }),
    });
    const vehicleLocation = `A1 Fahrzeug ${world.runId}`;
    await locationDialog
      .locator("#inventory-location-name")
      .fill(vehicleLocation);
    await locationDialog.locator("#inventory-location-type").click();
    for (const type of [
      "Lager",
      "Lagerraum",
      "Regal",
      "Fahrzeug",
      "Sonstiges",
    ]) {
      await expect(
        adminPage.getByRole("option", { name: type, exact: true }),
      ).toBeVisible();
    }
    await adminPage
      .getByRole("option", { name: "Fahrzeug", exact: true })
      .click();
    await locationDialog
      .locator("#inventory-location-description")
      .fill("Servicefahrzeug Nord");
    await locationDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(locationDialog).toHaveCount(0, { timeout: 20_000 });

    await adminPage.goto("/inventar");
    await expect(visibleText(adminPage, inventoryItemName)).toBeVisible();
    for (const view of ["Alle Artikel", "Lager", "Geplant", "Bewegungen"]) {
      await adminPage.getByRole("tab", { name: view, exact: true }).click();
      await expect(
        adminPage.getByRole("tab", { name: view, exact: true }),
      ).toHaveAttribute("data-state", "active");
    }
    await adminPage.getByRole("tab", { name: "Lager", exact: true }).click();
    await expect(
      inventoryLocationCard(adminPage, vehicleLocation),
    ).toContainText("Fahrzeug");
    await adminPage
      .getByRole("tab", { name: "Alle Artikel", exact: true })
      .click();
    await adminPage.getByLabel("Artikel suchen").fill(inventoryItemName);
    await expect(visibleText(adminPage, inventoryItemName)).toBeVisible();
    await expect(textInDom(adminPage, `A1 Typ W ${world.runId}`)).toHaveCount(
      0,
    );
    await adminPage.getByLabel("Artikel suchen").fill("");
    await adminPage.getByLabel("Nach Typ filtern").click();
    await adminPage
      .getByRole("option", { name: "Werkzeug", exact: true })
      .click();
    await expect(
      visibleText(adminPage, `A1 Typ W ${world.runId}`),
    ).toBeVisible();
    await expect(textInDom(adminPage, inventoryItemName)).toHaveCount(0);
    await adminPage.getByLabel("Nach Typ filtern").click();
    await adminPage
      .getByRole("option", { name: "Alle Typen", exact: true })
      .click();
    await selectFromSearchable(
      adminPage,
      adminPage.getByLabel("Nach Lager filtern"),
      inventoryLocationName,
    );
    await expect(visibleText(adminPage, inventoryItemName)).toBeVisible();
    await expect(textInDom(adminPage, `A1 Typ W ${world.runId}`)).toHaveCount(
      0,
    );

    await expectRedirectedAway(employeePage, "/inventar");
    await selectFromSearchable(
      adminPage,
      adminPage.getByLabel("Nach Lager filtern"),
      "Alle Lager",
    );
    const liveItemName = `A1 Inventar Live ${world.runId}`;
    await adminPage.getByLabel("Artikel suchen").fill(liveItemName);
    await expect(textInDom(adminPage, liveItemName)).toHaveCount(0);
    await createInventoryItem(bueroPage, { name: liveItemName });
    await expect(visibleText(adminPage, liveItemName)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("A1-41: Zu-/Abgang, Negativsperre und nachvollziehbare Bewegung", async ({
    adminPage,
    world,
  }) => {
    const inventoryItemName = `A1 Artikel ${world.runId}`;
    await adminPage.goto("/inventar");
    await requireVisiblePrecondition(
      visibleText(adminPage, inventoryItemName),
      {
        test: "A1-41",
        needs: "the inventory item created by A1-40/A1-44",
        grep: "A1-40/A1-44|A1-41",
        suite: "audit",
      },
    );
    let row = adminPage.getByRole("row").filter({ hasText: inventoryItemName });
    await row.getByRole("button", { name: "Aktionen", exact: true }).click();
    await adminPage.getByRole("menuitem", { name: "Bestand ändern" }).click();
    let dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Bestand ändern" }),
    });
    await dialog.locator("#inventory-stock-quantity").fill("2");
    await dialog.locator("#inventory-stock-reason").fill("A1 Zugang");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    row = adminPage.getByRole("row").filter({ hasText: inventoryItemName });
    await row.getByRole("button", { name: "Aktionen", exact: true }).click();
    await adminPage.getByRole("menuitem", { name: "Bestand ändern" }).click();
    dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Bestand ändern" }),
    });
    await dialog.getByRole("button", { name: "Entnehmen" }).click();
    await dialog.locator("#inventory-stock-quantity").fill("1");
    await dialog.locator("#inventory-stock-reason").fill("A1 Ausgang");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    row = adminPage.getByRole("row").filter({ hasText: inventoryItemName });
    await row.getByRole("button", { name: "Aktionen", exact: true }).click();
    await adminPage.getByRole("menuitem", { name: "Bestand ändern" }).click();
    dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Bestand ändern" }),
    });
    await dialog.getByRole("button", { name: "Entnehmen" }).click();
    await dialog.locator("#inventory-stock-quantity").fill("999");
    await dialog.locator("#inventory-stock-reason").fill("A1 Negativtest");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog.getByText(/Bestand.*reicht nicht aus/)).toBeVisible();
    await dialog.getByRole("button", { name: "Abbrechen" }).click();

    await adminPage.getByRole("tab", { name: "Bewegungen" }).click();
    const movement = adminPage
      .getByRole("row")
      .filter({ hasText: inventoryItemName })
      .filter({ hasText: "Eingang" });
    await expect(movement).toContainText("A1 Zugang");
    await expect(movement).toContainText(/5.*7|7.*5/);
    const outboundMovement = adminPage
      .getByRole("row")
      .filter({ hasText: inventoryItemName })
      .filter({ hasText: "Ausgang" });
    await expect(outboundMovement).toContainText("A1 Ausgang");
    await expect(outboundMovement).toContainText(/7.*6|6.*7/);
  });

  test("A1-39/A1-42: Material planen, geplant und ungeplant entnehmen, Projekt summiert", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const projectNumber = `A1-MAT-P-${world.runId}`;
    const projectTitle = `A1 Materialprojekt ${world.runId}`;
    const jobNumber = `A1-MAT-J-${world.runId}`;
    await createProject(adminPage, { projectNumber, title: projectTitle });
    await createJob(adminPage, {
      jobNumber,
      title: `A1 Materialauftrag ${world.runId}`,
      projectNumber,
      assignEmployeeName: "Emil",
    });

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.waitForLoadState("networkidle");
    const jobMaterialButton = adminPage.getByRole("button", {
      name: "Material planen",
    });
    await expect(jobMaterialButton).toBeEnabled({ timeout: 30_000 });
    await jobMaterialButton.click();
    let dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Material planen" }),
    });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel("Artikel suchen").fill(world.inventory.itemName);
    await dialog
      .getByRole("button")
      .filter({ hasText: world.inventory.itemName })
      .click();
    await dialog.locator('input[id$="-quantity"]').fill("3");
    await selectFromSearchable(
      adminPage,
      dialog.locator('button[id$="-location"]'),
      world.inventory.locationName,
    );
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    expect(
      (
        await getInventoryLedgerState(
          world.orgId,
          world.inventory.itemId,
          world.inventory.locationId,
        )
      ).quantityOnHand,
    ).toBe(world.inventory.initialQuantity);

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const plannedLine = employeePage
      .getByTestId("job-material-line")
      .filter({ hasText: world.inventory.itemName });
    await bookMaterialDialog(
      employeePage,
      plannedLine.getByRole("button", { name: "Entnahme buchen" }),
      "Entnahme buchen",
      "2",
    );
    const worldMaterialLine = employeePage
      .getByTestId("job-material-line")
      .filter({ hasText: world.inventory.itemName });
    await bookMaterialDialog(
      employeePage,
      worldMaterialLine.getByRole("button", { name: "Zurücklegen" }),
      "Material zurücklegen",
      "1",
      "Zurücklegen",
    );
    const returnReachedUi = await expect(worldMaterialLine)
      .toContainText(/\+1/, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!returnReachedUi) await employeePage.reload();
    await expect(worldMaterialLine).toContainText(/\+1/);
    await expect(worldMaterialLine).toContainText(world.inventory.itemName);
    await expect(worldMaterialLine).not.toContainText(/Abrechenbar/);
    await takeMaterialOnJobPage(
      employeePage,
      jobNumber,
      world.inventory.itemName,
      1,
    );

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    const stockBeforeDirectPlan = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId,
    );
    // P1-13 adds the project qualification client section immediately before
    // material. Wait for that boundary to hydrate so the first material click
    // cannot land on the streamed HTML before its handler is attached.
    await expect(
      visibleText(adminPage, "Geplante Qualifikationen"),
    ).toBeVisible({
      timeout: 30_000,
    });
    const projectMaterialButton = adminPage.getByRole("button", {
      name: "Material planen",
    });
    await expect(projectMaterialButton).toBeEnabled({ timeout: 30_000 });
    await projectMaterialButton.click();
    dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Material planen" }),
    });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel("Artikel suchen").fill(world.inventory.itemName);
    await dialog
      .getByRole("button")
      .filter({ hasText: world.inventory.itemName })
      .click();
    await dialog.locator('input[id$="-quantity"]').fill("1");
    await selectFromSearchable(
      adminPage,
      dialog.locator('button[id$="-location"]'),
      world.inventory.locationName,
    );
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    expect(
      await getInventoryLedgerState(
        world.orgId,
        world.inventory.itemId,
        world.inventory.locationId,
      ),
    ).toEqual(stockBeforeDirectPlan);
    await expect(
      textInDom(adminPage, "Noch kein direktes Projektmaterial erfasst."),
    ).toHaveCount(0);
    await expect(
      visibleText(adminPage, "Aus Aufträgen übernommen"),
    ).toBeVisible();
    await expect(visibleText(adminPage, "Projekt gesamt")).toBeVisible();
    await expect(
      visibleText(adminPage, world.inventory.itemName),
    ).toBeVisible();
    const projectTotal = projectMaterialTotal(
      adminPage,
      world.inventory.itemName,
    );
    await expect(projectTotal).toContainText("Bedarf");
    await expect(projectTotal).toContainText(/-3/);
    await expect(projectTotal).toContainText(/\+1/);
    await expect(projectTotal).toContainText(/Abrechenbar\s+2/);
  });

  test("A1-43: CSV-Spaltenzuordnung legt Stammdaten und Anfangsbewegung an", async ({
    adminPage,
    world,
  }) => {
    const importedItem = `A1 CSV Artikel ${world.runId}`;
    const importedLocation = `A1 CSV Lager ${world.runId}`;
    await adminPage.goto("/inventar");
    await adminPage.getByRole("button", { name: "CSV importieren" }).click();
    const dialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "CSV importieren" }),
    });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: `a1-import-${world.runId}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Bezeichnung;Gruppe;Ort;Anbieter;Menge;Einheit\n${importedItem};A1 Kategorie;${importedLocation};A1 CSV Lieferant;4;Stück`,
      ),
    });
    const mappings = {
      name: "Bezeichnung",
      categoryName: "Gruppe",
      locationName: "Ort",
      supplierName: "Anbieter",
      quantity: "Menge",
      unit: "Einheit",
    } as const;
    for (const [field, header] of Object.entries(mappings)) {
      await dialog.locator(`#inventory-import-${field}`).click();
      await adminPage
        .getByRole("option", { name: header, exact: true })
        .click();
    }
    await dialog.getByRole("button", { name: "Importieren" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    const importedRow = adminPage
      .getByRole("row")
      .filter({ hasText: importedItem });
    await expect(importedRow).toContainText("A1 Kategorie", {
      timeout: 20_000,
    });
    await expect(importedRow).toContainText(importedLocation);
    await expect(importedRow).toContainText(/4/);
    await importedRow
      .getByRole("button", { name: "Aktionen", exact: true })
      .click();
    await adminPage.getByRole("menuitem", { name: "Bearbeiten" }).click();
    const itemDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: "Artikel bearbeiten" }),
    });
    await expect(itemDialog.locator("#inventory-item-category")).toContainText(
      "A1 Kategorie",
    );
    await expect(itemDialog.locator("#inventory-item-supplier")).toContainText(
      "A1 CSV Lieferant",
    );
    await itemDialog.getByRole("button", { name: "Abbrechen" }).click();
    await adminPage.getByRole("tab", { name: "Lager" }).click();
    await expect(visibleText(adminPage, importedLocation)).toBeVisible();
    await adminPage.getByRole("tab", { name: "Bewegungen" }).click();
    const initialMovement = adminPage
      .getByRole("row")
      .filter({ hasText: importedItem });
    await expect(initialMovement).toContainText("Erstbestand");
    await expect(initialMovement).toContainText(/0.*4|4.*0/);
  });
});
