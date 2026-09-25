import { expect, test } from "../support/fixtures";
import { previousTestBusinessMonth } from "../../../lib/testing/business-date";
import { auditCheckpoint, saveAuditCheckpoint } from "../support/checkpoints";
import { prepareOutsidePeriodCorrection } from "../support/time-correction-fixtures";
import { captureResponsiveSection } from "../support/visual-evidence";
import { openRemainingP123Accounts, prepareP123PersonnelPrerequisites } from "../../golden/support/db/personnel";
import { closeP123LegacySequence, getP123State, getP123LegacyTransition, getTimeCorrectionState, seedP123UnclosedLegacySequence } from "../../golden/support/db/time-tracking";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import { requireVisiblePrecondition } from "../../golden/support/preconditions";
import { textInDom, typeIntoDatePicker, visibleText } from "../../golden/support/steps/shared";

function datePickerDigits(dateIso: string): string {
  return `${dateIso.slice(8, 10)}${dateIso.slice(5, 7)}${dateIso.slice(0, 4)}`;
}

const period = previousTestBusinessMonth();
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

  test("blocks close for an incomplete historical sequence and clears the finding after recalculation",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "assigns an employee exception and keeps a rejected adjustment out of the ledger",
        },
      ],
    },
    async ({
    adminPage,
    world,
  }, testInfo) => {
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
      // Own the foreign-period correction which previously arrived accidentally
      // from P1-22. It must never close this period's incomplete legacy sequence.
      const correctionReason = `P123 outside-period correction ${world.runId}`;
      let correctionState = await getTimeCorrectionState(world.orgId);
      if (
        !correctionState.revisions.some(
          (revision) => revision.reason === correctionReason,
        )
      ) {
        await prepareOutsidePeriodCorrection(world, {
          date: ownedBerlinDateAtOffset("p1-23", 121),
          reason: correctionReason,
        });
        correctionState = await getTimeCorrectionState(world.orgId);
      }
      const outsideCorrection = correctionState.revisions.find(
        (revision) => revision.reason === correctionReason,
      );
      expect(
        correctionState.applications.filter(
          (application) =>
            application.request_id === outsideCorrection?.request_id,
        ),
      ).toHaveLength(1);
      const closedTransition = await getP123LegacyTransition(
        world.orgId,
        world.users.employee.id,
        "clock_out",
        `${period.start}T08:00:00.000Z`,
      );
      if (closedTransition && !auditCheckpoint("p1-23.missingClockObserved")) {
        throw new Error(
          "The legacy sequence is already closed without a recorded missing-clock proof. Run the fresh P1-23 audit group.",
        );
      }
      if (!closedTransition) {
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
        saveAuditCheckpoint("p1-23.missingClockObserved", true);

        await closeP123LegacySequence({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      endedAt: `${period.start}T08:00:00.000Z`,
    });
      }
      const preparedPeriod = (await getP123State(world.orgId)).periods.find(
        (candidate) => candidate.period_start_date === period.start,
      );
      expect(preparedPeriod).toBeTruthy();
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
    const results = adminPage.getByRole('heading', { name: 'Monatswerte', exact: true }).locator('..');
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await captureResponsiveSection(adminPage, testInfo, results, 'p123-monthly-results-populated', async (width) => {
      if (width >= 768) {
        await expect(results.locator('table:visible')).toBeVisible();
        await expect(results.getByRole('row').filter({ hasText: employeeName })).toBeVisible();
        return;
      }
      await expect(results.locator('table:visible')).toHaveCount(0);
      const mobileResult = results.locator('[data-slot="list-row"]').filter({ hasText: employeeName });
      await expect(mobileResult).toBeVisible();
      for (const label of ['Soll', 'Gewertet', 'Differenz', 'Schlusssaldo', 'Sollquelle']) {
        await expect(mobileResult.locator('dt').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
      }
      expect(await results.evaluate((section) => [section, ...section.querySelectorAll<HTMLElement>('*')].filter((element) => element.getClientRects().length > 0 && element.scrollWidth > element.clientWidth + 1).length)).toBe(0);
      return mobileResult;
    });
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
