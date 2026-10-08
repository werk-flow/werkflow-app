import { getMemberActionErrorMessage } from '../../../lib/members/errors';
import { ROLE_LABELS } from '../../../lib/roles';
import { expect, test } from '../support/fixtures';
import {
  getJoinRequestStatuses,
  getOrganizationJoinCode,
  getPendingInviteCode,
} from '../../golden/support/db/shared';
import { createCustomer } from '../../golden/support/steps/customers';
import { dismissDialog } from '../../golden/support/steps/interaction';
import {
  ANY_MEMBER_CLOCK_STATUS,
  FOREIGN_ADMIN_JOIN_REFUSAL,
  INVITATION_STATUS,
  MEMBER_CHANGE_ROLE_ACTION,
  MEMBER_CLOCK_STATUS,
  MEMBER_DETAIL_PROGRESS,
  approveJoinRequestButton,
  cancelInvitationFromRow,
  createAdditionalOrganization,
  createOrganizationInOnboarding,
  expectRedirectedAway,
  invitationsTab,
  inviteMember,
  joinDialogDoneButton,
  joinOrganizationViaInviteLink,
  joinRequestPendingMessage,
  joinRequestsRegion,
  loginViaUi,
  memberActionsMenu,
  memberJoinedBanner,
  memberJoinedMessage,
  memberMenuItem,
  memberRow,
  memberRowActionsButton,
  memberRowWorkSchedule,
  openJoinOrganizationDialog,
  organizationSwitcher,
  requestJoinWithCode,
  requestMemberRemovalFromRow,
  signOutViaUi,
  signUpViaUi,
  simulatedPaymentButton,
  withdrawJoinRequestButton,
} from '../../golden/support/steps/organization';
import {
  SHARED_COPY,
  gotoReadOnlyRoute,
  selectFromSearchable,
  textInDom,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  DAILY_TIME_SUMMARY_NAME,
  TIME_PAGE_TEXT,
  clockInConfirmationButton,
  clockInLauncher,
  clockInOnJob,
  clockOut,
  dailyTimeSummaries,
  endClockBreak,
  firstDailyTimeSummary,
  startClockBreak,
  switchClockJob,
} from '../../golden/support/steps/time-tracking';
import { WORK_TIME_TEXT, createJob, createProject } from '../../golden/support/steps/work';
import { goldenTestEmail, goldenTestOrganizationName } from '../../golden/support/seed';
import { readOrganizationCode, upgradeChoiceLink } from '../support/a1-steps';

test.describe('A1 Organisation, Rollen und Stempeluhr @AUDIT-W1-A1', () => {
  test('A1-01/A1-07: Konto, erste Organisation und Auto-Ausstempeln beim Abmelden', async ({
    browser,
    world,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();
    const email = goldenTestEmail('a1-signup', world.runId);
    const password = `A1-Sicher!${world.runId}2026`;
    const organizationName = goldenTestOrganizationName('A1 Signup', world.runId);
    const firstName = 'Sina';
    const lastName = `Audit-${world.runId}`;

    await signUpViaUi(page, { firstName, lastName, email, password });
    if (/\/onboarding\/start/.test(page.url())) {
      await upgradeChoiceLink(page).click();
      await expect(page).toHaveURL(/\/upgrade/, { timeout: 30_000 });
    }
    if (/\/upgrade/.test(page.url())) {
      await simulatedPaymentButton(page).click();
      await expect(page).toHaveURL(/\/onboarding\/create-organization/, {
        timeout: 30_000,
      });
    }

    await createOrganizationInOnboarding(page, organizationName);
    await expect(visibleText(page, organizationName)).toBeVisible();
    const ownCode = await readOrganizationCode(page);
    expect(ownCode.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(ownCode.name).toBe(organizationName);
    await page.goto('/mitarbeiter');
    const ownerRow = memberRow(page, `${firstName} ${lastName}`);
    await expect(ownerRow).toContainText(ROLE_LABELS.admin);
    await expect(memberRowActionsButton(ownerRow)).toHaveCount(0);

    await clockInOnJob(page);
    await signOutViaUi(page);
    await loginViaUi(page, {
      email,
      password,
    });
    await expect(clockInLauncher(page)).toBeVisible();
    await signOutViaUi(page);
    await context.close();
  });

  test('A1-02: Ein Code erzeugt eine Beitrittsanfrage, die Freigabe öffnet die App ohne Neuladen', async ({
    adminPage,
    browser,
    world,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();
    const email = goldenTestEmail('a1-join', world.runId);
    const password = `A1-Beitritt!${world.runId}2026`;
    const firstName = 'Jana';
    const lastName = `Beitritt-${world.runId}`;
    const requesterName = `${firstName} ${lastName}`;

    await test.step('Ein neues Konto fragt per Code an und wartet außerhalb der App', async () => {
      await signUpViaUi(page, { firstName, lastName, email, password });

      await page.goto('/onboarding/join-organization');
      await requestJoinWithCode(page, await getOrganizationJoinCode(world.orgId));
      await expect(visibleText(page, joinRequestPendingMessage(world.orgName))).toBeVisible();
      expect(await getJoinRequestStatuses(world.orgId, email)).toEqual(['pending']);

      // Withdrawing frees the code field; the second request is the one the office decides.
      await withdrawJoinRequestButton(page).click();
      await requestJoinWithCode(page, await getOrganizationJoinCode(world.orgId));
      await expect(visibleText(page, joinRequestPendingMessage(world.orgName))).toBeVisible();
      expect(await getJoinRequestStatuses(world.orgId, email)).toEqual(['withdrawn', 'pending']);

      // The code alone grants no access: the app sends the requester back to the waiting state.
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/onboarding\/join-organization/, { timeout: 30_000 });
      await expect(visibleText(page, joinRequestPendingMessage(world.orgName))).toBeVisible();
    });

    await test.step('Das Büro sieht die Anfrage in Aufgaben und gibt sie unter Mitarbeiter frei', async () => {
      await adminPage.goto('/aufgaben');
      await expect(adminPage.getByRole('main').getByTestId('attention-join-request-tasks')).toContainText(
        requesterName,
      );
      await adminPage.goto('/mitarbeiter');
      const joinRequests = joinRequestsRegion(adminPage);
      await expect(joinRequests).toContainText(email);
      const approve = approveJoinRequestButton(joinRequests, requesterName);

      // Approval reaches the waiting page without any action by the requester.
      // The page then loads the app as a new document, so the proof is the
      // unprompted arrival; a freshness measurement cannot span a document load.
      await approve.click();
      await expect(page).toHaveURL(/\/dashboard\?joined=/);
      await expect(organizationSwitcher(page, world.orgName)).toBeVisible();
      expect(await getJoinRequestStatuses(world.orgId, email)).toEqual(['withdrawn', 'approved']);
      await expect(memberRow(adminPage, requesterName)).toContainText(ROLE_LABELS.employee);
    });

    await context.close();
  });

  test('A1-02/A1-03/A1-05/A1-26/A1-27/A1-28: Beitritt per Code, Organisationswechsel, Live-Status, Pause, Auftragwechsel und Org-Sperre', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const secondaryOrganizationName = goldenTestOrganizationName('A1 Zweitorg', world.runId);
    const primaryOrganizationCustomer = `Nur Hauptorg ${world.runId}`;
    const secondaryOrganizationCustomer = `Nur Zweitorg ${world.runId}`;
    const primaryOrganizationSwitcher = organizationSwitcher(adminPage, world.orgName);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    await test.step('Admin legt eine zweite Organisation an, der Handwerker tritt per Code bei', async () => {
      await createCustomer(adminPage, primaryOrganizationCustomer);
      await adminPage.goto('/dashboard');
      await createAdditionalOrganization(adminPage, secondaryOrganizationName);
      await expect(visibleText(adminPage, secondaryOrganizationName)).toBeVisible();
      const secondaryOrganization = await readOrganizationCode(adminPage);
      expect(secondaryOrganization.name).toBe(secondaryOrganizationName);
      const secondaryOrganizationCode = secondaryOrganization.code;
      expect(secondaryOrganizationCode).toMatch(/^[A-Z0-9]{6}$/);
      await createCustomer(adminPage, secondaryOrganizationCustomer);

      await employeePage.goto('/dashboard');
      const joinDialog = await openJoinOrganizationDialog(employeePage);
      await requestJoinWithCode(joinDialog, secondaryOrganizationCode);
      await expect(joinDialog).toContainText(joinRequestPendingMessage(secondaryOrganizationName));
      await joinDialogDoneButton(joinDialog).click();
      await expect(joinDialog).toBeHidden();

      // The code alone grants nothing: the admin of the new organization approves.
      await adminPage.goto('/mitarbeiter');
      await approveJoinRequestButton(joinRequestsRegion(adminPage), employeeName).click();
      await expect(memberJoinedBanner(adminPage)).toContainText(memberJoinedMessage(employeeName));
      await expect(memberRow(adminPage, employeeName)).toContainText(ROLE_LABELS.employee);

      await employeePage.reload();
      await selectFromSearchable(
        employeePage,
        organizationSwitcher(employeePage, world.orgName),
        secondaryOrganizationName,
        { searchFirst: false },
      );
      await expect(organizationSwitcher(employeePage, secondaryOrganizationName)).toBeEnabled({
        timeout: 30_000,
      });
      await expectRedirectedAway(employeePage, '/kunden');
    });

    await test.step('Der Code einer Organisation eines anderen Admins wird abgelehnt', async () => {
      const foreignOrganizationCode = await getOrganizationJoinCode(world.outsider.orgId);
      const joinDialog = await openJoinOrganizationDialog(employeePage);
      await requestJoinWithCode(joinDialog, foreignOrganizationCode);
      await expect(visibleText(employeePage, FOREIGN_ADMIN_JOIN_REFUSAL)).toBeVisible();
      await dismissDialog(joinDialog);
    });

    await test.step('Organisationswechsel trennt die Daten beider Organisationen', async () => {
      await selectFromSearchable(
        employeePage,
        organizationSwitcher(employeePage, secondaryOrganizationName),
        world.orgName,
        { searchFirst: false },
      );
      // The switcher's disabled state while a switch is pending is held by the
      // organization component contract with a held switch. A real switch
      // completes before the first poll; assert the settled state and the data
      // isolation instead.
      await expect(organizationSwitcher(employeePage, world.orgName)).toBeEnabled({
        timeout: 30_000,
      });
      await employeePage.goto('/auftraege');
      await expect(textInDom(employeePage, secondaryOrganizationCustomer)).toHaveCount(0);

      await selectFromSearchable(
        adminPage,
        organizationSwitcher(adminPage, secondaryOrganizationName),
        world.orgName,
        { searchFirst: false },
      );
      await expect(primaryOrganizationSwitcher).toBeEnabled({ timeout: 30_000 });
      await adminPage.goto('/kunden');
      await expect(textInDom(adminPage, secondaryOrganizationCustomer)).toHaveCount(0);
      await selectFromSearchable(adminPage, primaryOrganizationSwitcher, secondaryOrganizationName, {
        searchFirst: false,
      });
      await expect(organizationSwitcher(adminPage, secondaryOrganizationName)).toBeEnabled({
        timeout: 30_000,
      });
      await adminPage.goto('/kunden');
      await expect(visibleText(adminPage, secondaryOrganizationCustomer)).toBeVisible();
      await expect(textInDom(adminPage, primaryOrganizationCustomer)).toHaveCount(0);
      await selectFromSearchable(
        adminPage,
        organizationSwitcher(adminPage, secondaryOrganizationName),
        world.orgName,
        { searchFirst: false },
      );
      await expect(primaryOrganizationSwitcher).toBeEnabled({ timeout: 30_000 });
    });

    const firstJob = `A1 Zeitauftrag 1 ${world.runId}`;
    const secondJob = `A1 Zeitauftrag 2 ${world.runId}`;
    const firstJobNumber = `A1-Z1-${world.runId}`;
    const secondJobNumber = `A1-Z2-${world.runId}`;
    const timeProjectNumber = `A1-ZP-${world.runId}`;

    await test.step('Stempeln, Pause und Auftragwechsel erscheinen live in der Mitgliederliste', async () => {
      await createProject(adminPage, {
        projectNumber: timeProjectNumber,
        title: `A1 Zeitprojekt ${world.runId}`,
      });
      await createJob(adminPage, {
        jobNumber: firstJobNumber,
        title: firstJob,
        assignEmployeeName: world.users.employee.firstName,
        projectNumber: timeProjectNumber,
      });
      await createJob(adminPage, {
        jobNumber: secondJobNumber,
        title: secondJob,
        assignEmployeeName: world.users.employee.firstName,
        projectNumber: timeProjectNumber,
      });

      await employeePage.goto('/zeiterfassung');
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.notClockedIn)).toBeVisible();
      await adminPage.goto('/mitarbeiter');
      const employeeRow = memberRow(adminPage, employeeName);
      await clockInOnJob(employeePage, firstJob);
      await employeePage.goto('/zeiterfassung');
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.working)).toBeVisible();
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.workTime)).toBeVisible();
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.breakTime)).toBeVisible();
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.overtimeToday)).toBeVisible();
      await expect(employeeRow).toContainText(MEMBER_CLOCK_STATUS.working, { timeout: 30_000 });
      await startClockBreak(employeePage);
      await employeePage.goto('/zeiterfassung');
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.onBreak)).toBeVisible();
      await expect(employeeRow).toContainText(MEMBER_CLOCK_STATUS.onBreak, { timeout: 30_000 });
      await endClockBreak(employeePage, firstJob);
      await employeePage.goto('/zeiterfassung');
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.working)).toBeVisible();
      await switchClockJob(employeePage, secondJob);
    });

    await test.step('Eingestempelt in einer Organisation sperrt das Einstempeln in der anderen', async () => {
      await employeePage.goto('/dashboard');
      await selectFromSearchable(
        employeePage,
        organizationSwitcher(employeePage, world.orgName),
        secondaryOrganizationName,
      );
      await expect(visibleText(employeePage, secondaryOrganizationName)).toBeVisible({
        timeout: 20_000,
      });
      await clockInLauncher(employeePage).click();
      await clockInConfirmationButton(employeePage).click();
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.clockedInElsewhere)).toBeVisible({
        timeout: 20_000,
      });
      await selectFromSearchable(
        employeePage,
        organizationSwitcher(employeePage, secondaryOrganizationName),
        world.orgName,
      );
      await clockOut(employeePage);
    });

    await test.step('Tagessummen und auftragsbezogene Zeit sind sichtbar', async () => {
      await employeePage.goto('/zeiterfassung');
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.notClockedIn)).toBeVisible();
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.workTime)).toBeVisible();
      await expect(visibleText(employeePage, TIME_PAGE_TEXT.breakTime)).toBeVisible();
      await expect(dailyTimeSummaries(employeePage)).toHaveCount(7);
      await expect(firstDailyTimeSummary(employeePage)).toHaveAttribute('title', DAILY_TIME_SUMMARY_NAME);
      for (const jobNumber of [firstJobNumber, secondJobNumber]) {
        await gotoReadOnlyRoute(employeePage, `/auftraege/${jobNumber}`);
        await expect(textInDom(employeePage, WORK_TIME_TEXT.noJobTime)).toHaveCount(0);
      }
      await adminPage.goto(`/auftraege/projekt/${timeProjectNumber}`);
      const projectTimeSummary = visibleText(adminPage, WORK_TIME_TEXT.projectTotalHours);
      try {
        await expect(projectTimeSummary).toBeVisible({ timeout: 20_000 });
      } catch {
        await adminPage.reload();
        await expect(projectTimeSummary).toBeVisible({ timeout: 30_000 });
      }
    });
  });

  test('A1-04/A1-06: Handwerker-Oberfläche und konservative Rollenregeln', async ({
    adminPage,
    browser,
    bueroPage,
    employeePage,
    world,
  }) => {
    await expectRedirectedAway(employeePage, '/mitarbeiter');
    await adminPage.goto('/mitarbeiter');
    const adminOwnRow = memberRow(adminPage, world.users.admin.firstName);
    await expect(adminOwnRow).toBeVisible();
    await expect(memberRowActionsButton(adminOwnRow)).toHaveCount(0);

    await bueroPage.goto('/mitarbeiter');
    const bueroOwnRow = memberRow(bueroPage, world.users.buero.firstName);
    const adminRow = memberRow(bueroPage, world.users.admin.firstName);
    const employeeRow = memberRow(bueroPage, world.users.employee.firstName);
    await expect(memberRowActionsButton(bueroOwnRow)).toHaveCount(0);
    await expect(memberRowActionsButton(adminRow)).toHaveCount(0);
    await expect(memberRowActionsButton(employeeRow)).toBeVisible();
    await expect(adminRow).toContainText(ROLE_LABELS.admin);
    await expect(bueroOwnRow).toContainText(ROLE_LABELS.buero);
    await expect(employeeRow).toContainText(ROLE_LABELS.employee);
    await expect(employeeRow).toContainText(ANY_MEMBER_CLOCK_STATUS);
    await expect(employeeRow.getByText('%')).toBeVisible();
    await expect(memberRowWorkSchedule(employeeRow)).toBeVisible();
    await memberRowActionsButton(employeeRow).click();
    await expect(memberMenuItem(bueroPage, 'details')).toBeVisible();
    await expect(memberMenuItem(bueroPage, 'remove')).toBeVisible();
    await expect(textInDom(bueroPage, MEMBER_CHANGE_ROLE_ACTION)).toHaveCount(0);
    await dismissDialog(memberActionsMenu(bueroPage));
    await expect(memberMenuItem(bueroPage, 'details')).toBeHidden();

    await employeeRow
      .getByText(`${world.users.employee.firstName} ${world.users.employee.lastName}`, { exact: true })
      .click();
    await expect(bueroPage).toHaveURL(/\/mitarbeiter\//);
    await expect(visibleText(bueroPage, MEMBER_DETAIL_PROGRESS)).toBeVisible();

    const adminInviteEmail = `delivered+a1-admin-${world.runId}@resend.dev`;
    const bueroInviteEmail = `delivered+a1-buero-${world.runId}@resend.dev`;
    await inviteMember(adminPage, adminInviteEmail, 'buero');
    await invitationsTab(adminPage).click();
    const adminInviteRow = memberRow(adminPage, adminInviteEmail);
    await expect(adminInviteRow).toContainText(ROLE_LABELS.buero);
    await expect(adminInviteRow).toContainText(INVITATION_STATUS.pending);
    await cancelInvitationFromRow(adminPage, adminInviteRow);
    await expect(adminInviteRow).toContainText(INVITATION_STATUS.cancelled, {
      timeout: 20_000,
    });

    await inviteMember(bueroPage, bueroInviteEmail, 'employee');
    await invitationsTab(bueroPage).click();
    const bueroInviteRow = memberRow(bueroPage, bueroInviteEmail);
    await expect(bueroInviteRow).toContainText(ROLE_LABELS.employee);
    await expect(bueroInviteRow).toContainText(INVITATION_STATUS.pending);

    await inviteMember(adminPage, world.invitee.email, 'buero');
    const inviteCode = await getPendingInviteCode(world.orgId, world.invitee.email);
    const inviteeContext = await browser.newContext({ locale: 'de-DE' });
    const inviteePage = await inviteeContext.newPage();
    await joinOrganizationViaInviteLink(inviteePage, inviteCode, world.invitee, world.orgId);
    await expect(visibleText(inviteePage, world.orgName)).toBeVisible();
    await adminPage.goto('/mitarbeiter');
    const joinedInviteeRow = memberRow(adminPage, world.invitee.firstName);
    await expect(joinedInviteeRow).toContainText(ROLE_LABELS.buero);

    await clockInOnJob(inviteePage);
    await expect(joinedInviteeRow).toContainText(MEMBER_CLOCK_STATUS.working, {
      timeout: 30_000,
    });
    // SI-006 protects recorded time; security_boundaries.sql proves the
    // database keeps the membership and the history. The page shows the denial.
    const removalDialog = await requestMemberRemovalFromRow(adminPage, joinedInviteeRow);
    await expect(removalDialog.getByRole('alert')).toContainText(
      getMemberActionErrorMessage('has_time_history'),
    );
    await removalDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await adminPage.reload();
    await expect(joinedInviteeRow).toContainText(ROLE_LABELS.buero);
    await expect(joinedInviteeRow).toContainText(MEMBER_CLOCK_STATUS.working);
    await signOutViaUi(inviteePage);
    await expect(joinedInviteeRow).toContainText(MEMBER_CLOCK_STATUS.notClockedIn);
    await inviteeContext.close();
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });
});
