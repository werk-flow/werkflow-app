import { expect, test } from './support/fixtures';
import { getEmployeeRecordStateByUser } from './support/db/personnel';
import { getCapabilityHistoryState, getJobQualificationState } from './support/db/qualifications';
import {
  attentionNotificationRow,
  markAttentionNotificationReadViaButton,
  openAufgaben,
} from './support/steps/attention';
import {
  addJobCapabilityRequirement,
  addTeamMemberViaManagement,
  assignCapabilityViaManagement,
  assignJobWithQualificationWarning,
  createCapabilityViaManagement,
  createTeamViaManagement,
  OWN_QUALIFICATION_COPY,
  renewCapabilityViaManagement,
} from './support/steps/qualifications';
import { expectGone, textInDom, visibleText } from './support/steps/shared';
import { createJob } from './support/steps/work';

// P1-09 — Teams and qualifications (@P1-09). One journey: a team and a
// certification are created, a job requirement explains the strongest coverage
// when the team is assigned, and the expiry notice disappears with the renewal.
// Each stage uses what the previous one created, so they are named steps of
// one test. Which team and qualification rows each role can read is a database
// rule (supabase/tests/people_boundaries.sql); the five coverage states, the
// apprentice notice, the edit and drag paths and team dissolution are the A5
// audit's edge cases.

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

test.describe('P1-09 Teams und Qualifikationen @P1-09', () => {
  test('Team und Zertifizierung anlegen, Anforderung mit Teamübernahme begründen und den Ablaufhinweis mit der Erneuerung auflösen', async ({
    adminPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const teamName = `Kundendienst ${world.runId}`;
    const certification = `Herstellertraining ${world.runId}`;
    const officeSkill = `Disposition ${world.runId}`;

    await test.step('Teams gruppieren Personen wirksamkeitsbezogen, ohne Berechtigungen zu vergeben', async () => {
      await createTeamViaManagement(adminPage, teamName);
      await addTeamMemberViaManagement(adminPage, { teamName, employeeName, validFrom: businessDate });
      await addTeamMemberViaManagement(adminPage, {
        teamName,
        employeeName: bueroName,
        validFrom: businessDate,
      });

      await employeePage.goto('/qualifikationen');
      await expect(visibleText(employeePage, teamName)).toBeVisible({ timeout: 15_000 });
      // A team is not authority: the field worker still cannot open management.
      await employeePage.goto('/mitarbeiter');
      await employeePage.waitForURL('**/dashboard', { timeout: 15_000 });
    });

    await test.step('Kuratierte Fähigkeiten und Zertifizierungen tragen Gültigkeit, interne Bestätigung und Nachweisstatus', async () => {
      await createCapabilityViaManagement(adminPage, {
        name: certification,
        kind: 'certification',
        warningDays: 30,
      });
      await createCapabilityViaManagement(adminPage, { name: officeSkill, kind: 'skill' });
      await assignCapabilityViaManagement(adminPage, {
        employeeName,
        capabilityName: certification,
        validFrom: shiftIsoDate(businessDate, -30),
        validUntil: shiftIsoDate(businessDate, -1),
        issuer: 'Interne Teststelle',
        confirmed: true,
        evidence: 'received',
        operationalNote: 'Nur interner Planungshinweis',
      });
      await assignCapabilityViaManagement(adminPage, {
        employeeName: bueroName,
        capabilityName: officeSkill,
        validFrom: businessDate,
      });

      // The employee sees the own entries read-only, never a colleague's.
      await employeePage.goto('/qualifikationen');
      await expect(visibleText(employeePage, certification)).toBeVisible({ timeout: 15_000 });
      await expect(visibleText(employeePage, OWN_QUALIFICATION_COPY.expired)).toBeVisible();
      await expect(visibleText(employeePage, OWN_QUALIFICATION_COPY.evidenceReceived)).toBeVisible();
      await expect(textInDom(employeePage, officeSkill)).toHaveCount(0);
    });

    await test.step('Auftragsanforderung erklärt die stärkste Abdeckung; Teamübernahme bleibt mit Begründung möglich und wird attribuiert', async () => {
      const jobNumber = `AUF-${world.runId}-P109-1`;
      await createJob(adminPage, { jobNumber, title: 'P1-09 Qualifikationsprüfung' });
      await addJobCapabilityRequirement(adminPage, {
        jobNumber,
        capabilityName: certification,
        requireConfirmation: true,
      });
      await assignJobWithQualificationWarning(adminPage, {
        jobNumber,
        teamName,
        employeeName,
        expectedStatus: 'expired',
        overrideReason: 'Erfahrener Kollege begleitet den Einsatz',
      });

      const state = await getJobQualificationState(world.orgId, jobNumber);
      expect(state.requirementCount).toBe(1);
      const latest = state.assessments.at(-1);
      if (!latest) throw new Error('P1-09: expected at least one qualification assessment');
      expect(latest.overrideReason).toBe('Erfahrener Kollege begleitet den Einsatz');
      expect(latest.teamSourceId).not.toBeNull();
      expect(latest.fingerprint).toMatch(/^p1-09:/);
    });

    await test.step('Ablaufhinweis wird ruhig dedupliziert; Erneuerung erhält die Historie und entfernt den alten Hinweis', async () => {
      const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
      const before = await getCapabilityHistoryState(world.orgId, employeeRecord.id, certification);
      expect(before.rows).toHaveLength(1);
      const [expiredRow] = before.rows;
      if (!expiredRow) throw new Error('P1-09: expected the expired certification row');

      await openAufgaben(adminPage);
      const notice = attentionNotificationRow(adminPage, expiredRow.id);
      await expect(notice).toHaveCount(1, { timeout: 15_000 });
      await expect(notice.getByText(certification)).toBeVisible();
      await markAttentionNotificationReadViaButton(adminPage, expiredRow.id);

      await renewCapabilityViaManagement(adminPage, {
        employeeName,
        capabilityName: certification,
        validFrom: businessDate,
        validUntil: shiftIsoDate(businessDate, 365),
      });
      const after = await getCapabilityHistoryState(world.orgId, employeeRecord.id, certification);
      expect(after.rows).toHaveLength(2);
      const [supersededRow, renewedRow] = after.rows;
      if (!supersededRow || !renewedRow) throw new Error('P1-09: expected two certification rows');
      expect(supersededRow.supersededAt).not.toBeNull();
      expect(renewedRow.supersedesId).toBe(supersededRow.id);
      expect(after.employeeEventTypes).toEqual(['qualification_added', 'qualification_renewed']);

      await openAufgaben(adminPage);
      await expectGone(attentionNotificationRow(adminPage, expiredRow.id), { timeout: 15_000 });
    });
  });
});
