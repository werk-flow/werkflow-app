import { expect, test } from "./support/fixtures";
import {
  getEmployeeRecordStateByUser,
  getLatestResponsibilityConfigurationState,
  getP123CountsAs,
  getP123State,
  openRemainingP123Accounts,
  prepareP123PersonnelPrerequisites,
} from "./support/db";
import { requireVisiblePrecondition } from "./support/preconditions";
import { typeIntoDatePicker, visibleText } from "./support/steps";

test.describe.configure({ mode: "serial" });

function previousBerlinMonth(): { month: string; start: string } {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
  });
  const currentMonth = formatter.format(new Date());
  const date = new Date(`${currentMonth}-15T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const month = date.toISOString().slice(0, 7);
  return { month, start: `${month}-01` };
}

function toDatePickerDigits(dateIso: string): string {
  return `${dateIso.slice(8, 10)}${dateIso.slice(5, 7)}${dateIso.slice(0, 4)}`;
}

let periodId: string;
const period = previousBerlinMonth();

test.describe("P1-23 time accounts and payroll handoff @P1-23 @GG-07", () => {
  test("configures a dated policy, explicit opening balances and payroll mapping @P1-23-stage-configure", async ({
    adminPage,
    world,
  }) => {
    const employees = await prepareP123PersonnelPrerequisites({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      validFrom: period.start,
    });
    await adminPage.goto("/einstellungen/zeiterfassung");
    const timeAccountSettings = adminPage
      .getByRole("heading", { name: "Zeitregeln & Lohnexport" })
      .locator("xpath=ancestor::main[1]");
    await expect(timeAccountSettings).toBeVisible();

    const policyForm = timeAccountSettings
      .getByRole("button", { name: "Standardversion bestätigen" })
      .locator("xpath=ancestor::form");
    await typeIntoDatePicker(
      policyForm,
      "Gültig ab",
      toDatePickerDigits(period.start),
    );
    await policyForm
      .getByRole("button", { name: "Standardversion bestätigen" })
      .click();
    await expect(visibleText(timeAccountSettings, "Version 1")).toBeVisible();

    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const accountForm = timeAccountSettings
      .getByLabel(`Anfangssaldo in Minuten für ${adminName}`)
      .locator("xpath=ancestor::form");
    await typeIntoDatePicker(
      accountForm,
      "Eröffnungsdatum",
      toDatePickerDigits(period.start),
    );
    await accountForm
      .getByLabel(`Anfangssaldo in Minuten für ${adminName}`)
      .fill("15");
    await accountForm.getByRole("button", { name: "Konto eröffnen" }).click();
    await openRemainingP123Accounts({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      openedOn: period.start,
    });
    await adminPage.reload();
    await expect(timeAccountSettings.getByText("Alle Zeitkonten sind eröffnet.")).toBeVisible();

    await timeAccountSettings
      .getByRole("button", { name: "Standardzuordnung bestätigen" })
      .click();
    await expect(timeAccountSettings.getByText("Aktuell: Version 1")).toBeVisible();

    const state = await getP123State(world.orgId);
    expect(state.accounts).toHaveLength(employees.length);
    expect(state.events.filter((event) => event.event_kind === "opening_balance")).toHaveLength(
      employees.length,
    );
    expect(state.mappings).toHaveLength(1);
  });

  test("prepares the complete workforce, closes one immutable version and creates the ZIP @P1-23-stage-close", async ({
    adminPage,
    world,
  }) => {
    await adminPage.goto("/zeiterfassung/einstellungen");
    await requireVisiblePrecondition(
      visibleText(adminPage, "Alle Zeitkonten sind eröffnet."),
      {
        test: "P1-23-stage-close",
        needs: "the policy, account and mapping setup from P1-23-stage-configure",
        grep: "P1-23-stage-configure|P1-23-stage-close",
        suite: "golden",
      },
    );
    await adminPage.goto("/zeiterfassung/perioden");
    await adminPage.getByLabel("Monat").fill(period.month);
    await adminPage.getByRole("button", { name: "Periode vorbereiten" }).click();
    await adminPage.waitForURL(/\/zeiterfassung\/perioden\/[0-9a-f-]{36}$/);
    await expect(adminPage.getByRole("heading", { name: "Prüfhinweise" })).toBeVisible();
    const preparedState = await getP123State(world.orgId);
    const preparedPeriod = preparedState.periods.find(
      (candidate) => candidate.period_start_date === period.start,
    );
    const approvalFindingIds = preparedState.findings
      .filter(
        (finding) =>
          finding.calculation_id === preparedPeriod?.current_calculation_id &&
          finding.severity === "approval_required",
      )
      .map((finding) => finding.id);
    for (const findingId of approvalFindingIds) {
      await adminPage.getByTestId(`approve-finding-${findingId}`).click();
      await expect(
        adminPage.getByTestId(`approve-finding-${findingId}`),
      ).toHaveCount(0);
    }
    await adminPage.getByRole("button", { name: "Monat abschließen" }).click();
    await expect(visibleText(adminPage, "Abgeschlossen")).toBeVisible();
    await adminPage
      .getByRole("button", { name: "Deterministisches ZIP erzeugen" })
      .click();
    await expect(visibleText(adminPage, "Version 1 · Bereit")).toBeVisible({
      timeout: 30_000,
    });

    const state = await getP123State(world.orgId);
    expect(state.periods).toHaveLength(1);
    expect(state.periods[0]?.state).toBe("closed");
    periodId = state.periods[0]!.id;
    expect(
      state.results.filter(
        (result) => result.calculation_id === state.periods[0]!.current_calculation_id,
      ),
    ).toHaveLength(state.accounts.length);
    expect(state.closes).toHaveLength(1);
    expect(state.exports).toHaveLength(1);
    expect(state.exports[0]).toMatchObject({ state: "ready", version: 1 });
  });

  test("shows the employee account with responsibility-aware navigation and keeps outsider reads empty @P1-23-stage-visibility", async ({
    employeePage,
    world,
  }) => {
    await employeePage.goto("/zeiterfassung/zeitkonto");
    await requireVisiblePrecondition(visibleText(employeePage, "Abgeschlossen"), {
      test: "P1-23-stage-visibility",
      needs: "the closed period from P1-23-stage-close",
      grep: "P1-23-stage-configure|P1-23-stage-close|P1-23-stage-visibility",
      suite: "golden",
    });
    await expect(employeePage.getByRole("heading", { name: "Zeitkonto" })).toBeVisible();
    await expect(employeePage.getByRole("heading", { name: "Monatsabschlüsse" })).toBeVisible();
    const [employeeRecord, timeApproval] = await Promise.all([
      getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
      getLatestResponsibilityConfigurationState(world.orgId, "time_approval"),
    ]);
    const isEffectiveTimeApprover =
      timeApproval.mode === "selected" &&
      timeApproval.holderEmployeeRecordIds.includes(employeeRecord.id);
    await expect(employeePage.getByRole("link", { name: "Perioden" })).toHaveCount(
      isEffectiveTimeApprover ? 1 : 0,
    );
    await expect(employeePage.getByRole("link", { name: "Regeln & Export" })).toHaveCount(0);

    const outsiderCounts = await getP123CountsAs(world.outsider.admin, world.orgId);
    expect(outsiderCounts).toEqual({
      time_accounts: 0,
      time_periods: 0,
      time_period_employee_results: 0,
      payroll_exports: 0,
    });
  });

  test("reopens with a reason while retaining close and export history @P1-23-stage-reopen", async ({
    adminPage,
    world,
  }) => {
    if (!periodId) {
      const retained = await getP123State(world.orgId);
      periodId = retained.periods[0]?.id ?? "";
    }
    await adminPage.goto(`/zeiterfassung/perioden/${periodId}`);
    await requireVisiblePrecondition(visibleText(adminPage, "Abgeschlossen"), {
      test: "P1-23-stage-reopen",
      needs: "the closed and exported period from the preceding P1-23 stages",
      grep:
        "P1-23-stage-configure|P1-23-stage-close|P1-23-stage-visibility|P1-23-stage-reopen",
      suite: "golden",
    });
    const reopenForm = adminPage
      .getByRole("button", { name: "Wieder öffnen" })
      .locator("xpath=ancestor::form");
    await reopenForm.getByRole("textbox").fill("Korrektur für Folgelauf erforderlich");
    await reopenForm.getByRole("button", { name: "Wieder öffnen" }).click();
    await expect
      .poll(async () => (await getP123State(world.orgId)).periods[0]?.state, {
        timeout: 30_000,
      })
      .toBe("reopened");
    await adminPage.reload();
    await expect(visibleText(adminPage, "Wieder geöffnet")).toBeVisible();

    const state = await getP123State(world.orgId);
    expect(state.periods[0]?.state).toBe("reopened");
    expect(state.closes).toHaveLength(1);
    expect(state.exports).toHaveLength(1);
    expect(
      state.events.filter((event) => event.event_kind === "period_reopen_reversal"),
    ).toHaveLength(state.accounts.length);
  });
});
