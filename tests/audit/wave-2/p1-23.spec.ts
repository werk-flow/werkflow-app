import { expect, test } from "../../golden/support/fixtures";
import {
  closeP123LegacySequence,
  getP123State,
  openRemainingP123Accounts,
  prepareP123PersonnelPrerequisites,
  seedP123UnclosedLegacySequence,
} from "../../golden/support/db";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import { requireVisiblePrecondition } from "../../golden/support/preconditions";
import {
  textInDom,
  typeIntoDatePicker,
  visibleText,
} from "../../golden/support/steps";

test.describe.configure({ mode: "serial" });

function previousBerlinMonth(): { month: string; start: string } {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
  });
  const date = new Date(`${formatter.format(new Date())}-15T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const month = date.toISOString().slice(0, 7);
  return { month, start: `${month}-01` };
}

function datePickerDigits(dateIso: string): string {
  return `${dateIso.slice(8, 10)}${dateIso.slice(5, 7)}${dateIso.slice(0, 4)}`;
}

const period = previousBerlinMonth();
const adjustmentDate = ownedBerlinDateAtOffset("p1-23", 120);

test.describe("P1-23 time-account audit @AUDIT-W2-P1-23 @AUDIT-W2", () => {
  // Catalog mapping: P1-23-F01…F18 cover dated policies, employee exceptions,
  // account openings and adjustments here. F19…F36 cover review findings,
  // recalculation and close gates here plus GG-07. F37…F50 are completed by
  // GG-07, the deterministic export unit tests, SQL/RLS assertions and the
  // DEV canary acceptance record.
  test("assigns an employee exception and keeps a rejected adjustment out of the ledger", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const employees = await prepareP123PersonnelPrerequisites({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      validFrom: period.start,
    });
    await adminPage.goto("/zeiterfassung/einstellungen");
    const settings = adminPage
      .getByRole("heading", { name: "Zeitregeln & Lohnexport" })
      .locator("xpath=ancestor::main[1]");
    const policyForm = settings
      .getByRole("button", { name: "Standardversion bestätigen" })
      .locator("xpath=ancestor::form");
    await typeIntoDatePicker(
      policyForm,
      "Gültig ab",
      datePickerDigits(period.start),
    );
    await policyForm
      .getByRole("button", { name: "Standardversion bestätigen" })
      .click();
    await expect(visibleText(settings, "Version 1")).toBeVisible();
    const exceptionPolicyName = `Sonderregel ${world.runId}`;
    await policyForm.getByLabel("Name").fill(exceptionPolicyName);
    await policyForm
      .getByRole("button", { name: "Neue Ausnahmeregel anlegen" })
      .click();
    await expect(
      visibleText(settings, `${exceptionPolicyName} · V1`),
    ).toBeVisible();
    await openRemainingP123Accounts({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      openedOn: period.start,
    });
    await adminPage.reload();

    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const assignmentForm = settings
      .getByLabel(`Regel gültig ab für ${employeeName}`)
      .locator("xpath=ancestor::form");
    await typeIntoDatePicker(
      assignmentForm,
      `Regel gültig ab für ${employeeName}`,
      datePickerDigits(period.start),
    );
    await assignmentForm
      .getByRole("button", { name: `${exceptionPolicyName} · V1` })
      .click();
    await expect
      .poll(
        async () => (await getP123State(world.orgId)).policyAssignments.length,
        { timeout: 20_000 },
      )
      .toBe(1);

    const accountBefore = (await getP123State(world.orgId)).accounts.find(
      (account) =>
        account.employee_record_id ===
        employees.find((employee) => employee.userId === world.users.employee.id)?.id,
    );
    expect(accountBefore).toBeDefined();
    await bueroPage.goto("/zeiterfassung/einstellungen");
    const bueroSettings = bueroPage
      .getByRole("heading", { name: "Zeitregeln & Lohnexport" })
      .locator("xpath=ancestor::main[1]");
    await expect(
      visibleText(bueroSettings, "Büro-Nutzer können Korrekturen"),
    ).toBeVisible();
    const adjustmentForm = bueroSettings
      .getByLabel(`Wirksamkeitsdatum für ${employeeName}`)
      .locator("xpath=ancestor::form");
    await adjustmentForm.getByLabel("Minuten").fill("45");
    await adjustmentForm.getByLabel("Grund").fill("Audit: nicht übernehmen");
    await typeIntoDatePicker(
      adjustmentForm,
      `Wirksamkeitsdatum für ${employeeName}`,
      datePickerDigits(adjustmentDate),
    );
    await adjustmentForm.getByRole("button", { name: "Korrektur" }).click();
    await expect
      .poll(
        async () => (await getP123State(world.orgId)).adjustmentRequests.length,
        { timeout: 20_000 },
      )
      .toBe(1);
    await adminPage.reload();
    const decisionForm = settings
      .getByLabel(`Entscheidungsgrund für ${employeeName}`)
      .locator("xpath=ancestor::form");
    await decisionForm
      .getByLabel(`Entscheidungsgrund für ${employeeName}`)
      .fill("Audit-Ablehnung");
    await decisionForm.getByRole("button", { name: "Ablehnen" }).click();
    await expect
      .poll(
        async () =>
          (await getP123State(world.orgId)).adjustmentRequests[0]?.status,
        { timeout: 20_000 },
      )
      .toBe("rejected");

    const state = await getP123State(world.orgId);
    expect(state.policyAssignments).toHaveLength(1);
    expect(state.adjustmentRequests).toHaveLength(1);
    expect(state.adjustmentRequests[0]?.status).toBe("rejected");
    expect(
      state.accounts.find((account) => account.id === accountBefore!.id)
        ?.current_balance_minutes,
    ).toBe(accountBefore!.current_balance_minutes);
    expect(
      state.events.filter((event) => event.adjustment_request_id !== null),
    ).toHaveLength(0);
  });

  test("blocks close for an incomplete historical sequence and clears the finding after recalculation", async ({
    adminPage,
    world,
  }) => {
    await adminPage.goto("/zeiterfassung/einstellungen");
    await requireVisiblePrecondition(
      visibleText(adminPage, "Alle Zeitkonten sind eröffnet."),
      {
        test: "P1-23 audit close blocker",
        needs: "the policy and account setup from the preceding P1-23 audit test",
        grep:
          "assigns an employee exception|blocks close for an incomplete historical sequence",
        suite: "audit",
      },
    );
    const employee = (await prepareP123PersonnelPrerequisites({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      validFrom: period.start,
    })).find((item) => item.userId === world.users.employee.id);
    expect(employee).toBeDefined();
    await seedP123UnclosedLegacySequence({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      startedAt: `${period.start}T06:00:00.000Z`,
    });
    const calculationCountBeforePrepare = (await getP123State(world.orgId))
      .calculations.length;

    await adminPage.goto("/zeiterfassung/perioden");
    await adminPage.getByLabel("Monat").fill(period.month);
    await adminPage.getByRole("button", { name: "Periode vorbereiten" }).click();
    await expect
      .poll(
        async () =>
          (await getP123State(world.orgId)).calculations.length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(calculationCountBeforePrepare);
    const preparedState = await getP123State(world.orgId);
    const preparedPeriod = preparedState.periods.find(
      (candidate) => candidate.period_start_date === period.start,
    );
    expect(preparedPeriod).toBeTruthy();
    expect(
      preparedState.findings.some(
        (finding) =>
          finding.calculation_id === preparedPeriod?.current_calculation_id &&
          finding.finding_kind === "missing_clock",
      ),
    ).toBe(true);
    await adminPage.goto(`/zeiterfassung/perioden/${preparedPeriod!.id}`);
    await expect(visibleText(adminPage, "Fehlende Buchung")).toBeVisible();
    await expect(
      adminPage.getByRole("button", { name: "Monat abschließen" }),
    ).toBeDisabled();

    await closeP123LegacySequence({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      endedAt: `${period.start}T08:00:00.000Z`,
    });
    const calculationCountBeforeRecalculation = (
      await getP123State(world.orgId)
    ).calculations.length;
    await adminPage.goto("/zeiterfassung/perioden");
    await adminPage.getByLabel("Monat").fill(period.month);
    await adminPage.getByRole("button", { name: "Periode vorbereiten" }).click();
    await expect
      .poll(
        async () => (await getP123State(world.orgId)).calculations.length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(calculationCountBeforeRecalculation);
    await adminPage.goto(`/zeiterfassung/perioden/${preparedPeriod!.id}`);
    await expect(textInDom(adminPage, "Fehlende Buchung")).toHaveCount(0);
    const state = await getP123State(world.orgId);
    expect(state.calculations.length).toBeGreaterThanOrEqual(2);
    const recalculatedPeriod = state.periods.find(
      (candidate) => candidate.id === preparedPeriod!.id,
    );
    expect(recalculatedPeriod).toBeTruthy();
    expect(
      state.findings.filter(
        (finding) =>
          finding.calculation_id === recalculatedPeriod!.current_calculation_id &&
          finding.finding_kind === "missing_clock",
      ),
    ).toHaveLength(0);
  });
});
