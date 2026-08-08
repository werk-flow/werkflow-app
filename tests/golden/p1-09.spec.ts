import { expect, test } from './support/fixtures';
import {
  getCapabilityHistoryState,
  getEmployeeRecordStateByUser,
  getJobQualificationState,
  getVisibleQualificationStateAs,
} from './support/db';
import {
  addConditionViaDialog,
  addJobCapabilityRequirement,
  addTeamMemberViaManagement,
  assignCapabilityViaManagement,
  assignJobWithQualificationWarning,
  attentionNotificationRow,
  createCapabilityViaManagement,
  createJob,
  createTeamViaManagement,
  markAttentionNotificationReadViaButton,
  openAufgaben,
  openMemberDetailFromList,
  renewCapabilityViaManagement,
  setApprenticeWarningViaManagement,
  visibleText,
} from './support/steps';

// P1-09 sorts last. It therefore runs after the complete inherited P1-08
// world in the full suite and on a fresh world when focused. It depends on no
// responsibility holder, uses run-scoped names, and derives every row/count
// expectation from the database, so both modes exercise the same facts.

test.describe.configure({ mode: 'serial' });

const TODAY_ISO = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function teamName(runId: string): string {
  return `Kundendienst ${runId}`;
}

function certificationName(runId: string): string {
  return `Herstellertraining ${runId}`;
}

function officeSkillName(runId: string): string {
  return `Disposition ${runId}`;
}

test.describe('P1-09 Teams und Qualifikationen @P1-09', () => {
  test('Teams gruppieren Personen wirksamkeitsbezogen, ohne Berechtigungen zu vergeben', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const name = teamName(world.runId);

    await createTeamViaManagement(adminPage, name);
    await addTeamMemberViaManagement(adminPage, {
      teamName: name,
      employeeName,
      validFrom: TODAY_ISO,
    });
    await addTeamMemberViaManagement(adminPage, {
      teamName: name,
      employeeName: bueroName,
      validFrom: TODAY_ISO,
    });

    await employeePage.goto('/qualifikationen');
    await expect(visibleText(employeePage, name)).toBeVisible({
      timeout: 15_000,
    });
    // A team is not authority: the field-worker still cannot open management.
    await employeePage.goto('/mitarbeiter');
    await employeePage.waitForURL('**/dashboard', { timeout: 15_000 });
  });

  test('Kuratierte Fähigkeiten und Zertifizierungen tragen Gültigkeit, interne Bestätigung und Nachweisstatus', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const certification = certificationName(world.runId);
    const officeSkill = officeSkillName(world.runId);

    await createCapabilityViaManagement(adminPage, {
      name: certification,
      kind: 'Zertifizierung',
      warningDays: 30,
    });
    await createCapabilityViaManagement(adminPage, {
      name: officeSkill,
      kind: 'Fähigkeit',
    });
    await assignCapabilityViaManagement(adminPage, {
      employeeName,
      capabilityName: certification,
      validFrom: shiftIsoDate(TODAY_ISO, -30),
      validUntil: shiftIsoDate(TODAY_ISO, -1),
      issuer: 'Interne Teststelle',
      confirmed: true,
      evidence: 'Erhalten',
      operationalNote: 'Nur interner Planungshinweis',
    });
    await assignCapabilityViaManagement(adminPage, {
      employeeName: bueroName,
      capabilityName: officeSkill,
      validFrom: TODAY_ISO,
    });

    await employeePage.goto('/qualifikationen');
    await expect(visibleText(employeePage, certification)).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, 'Abgelaufen')).toBeVisible();
    await expect(visibleText(employeePage, 'Nachweis: erhalten')).toBeVisible();
    await expect(employeePage.getByText(officeSkill)).toHaveCount(0);
  });

  test('Auftragsanforderung erklärt die stärkste Abdeckung; Teamübernahme bleibt mit Begründung möglich und wird attribuiert', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const jobNumber = `AUF-${world.runId}-P109-1`;
    const certification = certificationName(world.runId);

    await createJob(adminPage, {
      jobNumber,
      title: 'P1-09 Qualifikationsprüfung',
    });
    await addJobCapabilityRequirement(adminPage, {
      jobNumber,
      capabilityName: certification,
      requireConfirmation: true,
    });
    await assignJobWithQualificationWarning(adminPage, {
      jobNumber,
      teamName: teamName(world.runId),
      employeeName,
      expectedStatus: 'Abgelaufen',
      overrideReason: 'Erfahrener Kollege begleitet den Einsatz',
    });

    const state = await getJobQualificationState(world.orgId, jobNumber);
    expect(state.requirementCount).toBe(1);
    expect(state.assessments.length).toBeGreaterThan(0);
    const latest = state.assessments[state.assessments.length - 1];
    expect(latest.overrideReason).toBe(
      'Erfahrener Kollege begleitet den Einsatz'
    );
    expect(latest.teamSourceId).not.toBeNull();
    expect(latest.fingerprint).toMatch(/^p1-09:/);
  });

  test('Ausbildungs-Hinweis ist admin-gesteuert, standardmäßig aus und bleibt ein begründbarer Hinweis', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await bueroPage.goto('/mitarbeiter');
    await bueroPage
      .getByRole('tab', { name: 'Qualifikationen', exact: true })
      .click();
    await expect(
      bueroPage.getByRole('checkbox', {
        name: 'Ausbildungs-Hinweis aktivieren',
      })
    ).toBeDisabled();

    await openMemberDetailFromList(adminPage, employeeName);
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(TODAY_ISO),
      employmentTypeLabel: 'Ausbildung',
      note: 'P1-09 Ausbildungs-Hinweis',
    });
    await setApprenticeWarningViaManagement(adminPage, true);

    const jobNumber = `AUF-${world.runId}-P109-2`;
    await createJob(adminPage, {
      jobNumber,
      title: 'P1-09 Ausbildungs-Hinweis',
      assignEmployeeName: employeeName,
      qualificationOverrideReason: 'Einsatz wird im Betrieb begleitet',
    });
    const state = await getJobQualificationState(world.orgId, jobNumber);
    expect(state.requirementCount).toBe(0);
    expect(
      state.assessments.some(
        (assessment) =>
          assessment.overrideReason === 'Einsatz wird im Betrieb begleitet'
      )
    ).toBe(true);
  });

  test('Ablaufhinweis wird ruhig dedupliziert; Erneuerung erhält die Historie und entfernt den alten Hinweis', async ({
    adminPage,
    world,
  }) => {
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const certification = certificationName(world.runId);
    const before = await getCapabilityHistoryState(
      world.orgId,
      employeeRecord.id,
      certification
    );
    expect(before.rows).toHaveLength(1);
    const expiredRecordId = before.rows[0].id;

    await openAufgaben(adminPage);
    const notice = attentionNotificationRow(adminPage, expiredRecordId);
    await expect(notice).toHaveCount(1, { timeout: 15_000 });
    await expect(notice.getByText(certification)).toBeVisible();
    await markAttentionNotificationReadViaButton(adminPage, expiredRecordId);

    await renewCapabilityViaManagement(adminPage, {
      employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      capabilityName: certification,
      validFrom: TODAY_ISO,
      validUntil: shiftIsoDate(TODAY_ISO, 365),
    });
    const after = await getCapabilityHistoryState(
      world.orgId,
      employeeRecord.id,
      certification
    );
    expect(after.rows).toHaveLength(2);
    expect(after.rows[0].supersededAt).not.toBeNull();
    expect(after.rows[1].supersedesId).toBe(after.rows[0].id);
    expect(after.employeeEventTypes).toEqual([
      'qualification_added',
      'qualification_renewed',
    ]);

    await openAufgaben(adminPage);
    await expect(attentionNotificationRow(adminPage, expiredRecordId)).toHaveCount(
      0,
      { timeout: 15_000 }
    );
  });

  test('Privacy-Matrix per RLS: eigene operative Daten, Manager-Übersicht, keine Kollegendetails oder fremde Organisation', async ({
    employeePage,
    world,
  }) => {
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const bueroRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.buero.id
    );
    const [employeeView, managerView, outsiderView] = await Promise.all([
      getVisibleQualificationStateAs(world.users.employee, world.orgId),
      getVisibleQualificationStateAs(world.users.admin, world.orgId),
      getVisibleQualificationStateAs(world.outsider.admin, world.orgId),
    ]);

    expect(employeeView.teamEmployeeRecordIds).toEqual([employeeRecord.id]);
    expect(employeeView.capabilityEmployeeRecordIds).toEqual([
      employeeRecord.id,
    ]);
    expect(employeeView.evidenceStates).toEqual(['pending', 'received']);
    expect(employeeView.requirementCount).toBe(0);
    expect(employeeView.assessmentCount).toBe(0);

    expect(managerView.teamEmployeeRecordIds).toEqual(
      [employeeRecord.id, bueroRecord.id].sort()
    );
    expect(managerView.capabilityEmployeeRecordIds).toEqual(
      [employeeRecord.id, bueroRecord.id].sort()
    );
    expect(managerView.requirementCount).toBeGreaterThan(0);
    expect(managerView.assessmentCount).toBeGreaterThan(0);

    expect(outsiderView).toEqual({
      teamEmployeeRecordIds: [],
      capabilityEmployeeRecordIds: [],
      evidenceStates: [],
      requirementCount: 0,
      assessmentCount: 0,
    });

    await employeePage.goto('/qualifikationen');
    await expect(
      employeePage.getByText(officeSkillName(world.runId))
    ).toHaveCount(0);
  });
});
