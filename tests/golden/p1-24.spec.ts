import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { expect, test } from './support/fixtures';
import { getEmployeeRecordStateByUser, getP124State } from './support/db/personnel';
import { expectLiveWithin } from './support/live';
import { ACCESS_STATE_LABELS } from '../../lib/personnel/lifecycle';
import {
  acknowledgeRequirementButton,
  changeOrganizationAccess,
  confirmReceiptButton,
  createOnboardingPlan,
  exportWorkingStateButton,
  openMemberDetailFromList,
  PEOPLE_LIFECYCLE_COPY,
  personnelLifecycle,
  protectedFileReleaseButton,
  publishOnboardingTemplate,
  receiptConfirmedBanner,
  templateVersionLabel,
  uploadProtectedPersonnelFile,
} from './support/steps/personnel';
import { testData, textInDom, visibleText } from './support/steps/shared';

// One connected onboarding: template and plan, a protected document released
// live to the employee, the employee's receipts, the controlled access
// transitions and the export. Replay, stale versions, Büro and outsider
// visibility, retained history and organization teardown are proven in
// supabase/tests/p1_24_people_lifecycle.sql; audit P1-24 keeps the role and
// organization denials a user sees.

const templateName = testData`Sicherer Einstieg`;
const acknowledgementTitle = testData`Betriebsregeln bestätigen`;
const protectedFileName = testData`willkommen-p1-24.txt`;

test.describe('P1-24 controlled people lifecycle @P1-24 @GG-07', () => {
  test('onboards an employee with a protected document, receipts and controlled access @P1-24-stage-setup @P1-24-stage-documents-onboarding @P1-24-stage-access-transition @P1-24-stage-boundaries @FRESHNESS', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeRecordId = (await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id)).id;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const lifecycle = personnelLifecycle(adminPage);

    await test.step('Publish a template and create the onboarding plan from it', async () => {
      await adminPage.goto('/einstellungen/mitarbeiter');
      await expect(visibleText(adminPage, PEOPLE_LIFECYCLE_COPY.noTemplate)).toBeVisible();
      await publishOnboardingTemplate(adminPage, {
        name: templateName,
        firstItemType: 'acknowledgement',
        firstItemTitle: acknowledgementTitle,
      });
      await expect(visibleText(adminPage, templateName)).toBeVisible({ timeout: 15_000 });

      await openMemberDetailFromList(adminPage, employeeName);
      await expect(lifecycle.getByText(PEOPLE_LIFECYCLE_COPY.noAccessRule)).toBeVisible();
      await createOnboardingPlan(adminPage, templateVersionLabel(templateName, 1));
      await expect(visibleText(lifecycle, acknowledgementTitle)).toBeVisible({ timeout: 15_000 });
      const state = await getP124State(world.orgId);
      expect(
        state.requirements.find(
          (item) => item.employee_record_id === employeeRecordId && item.title === acknowledgementTitle,
        ),
      ).toMatchObject({ requirement_type: 'acknowledgement', blocks_access: true, state: 'missing' });
    });

    await test.step('Release a protected document live and receive both employee receipts', async () => {
      await employeePage.goto('/aufgaben');
      await uploadProtectedPersonnelFile(adminPage, {
        fileName: protectedFileName,
        content: 'P1-24 protected acceptance file',
        documentType: 'Willkommensunterlage',
      });

      await expectLiveWithin(visibleText(employeePage, protectedFileName), {
        label: 'released protected personnel document',
        actingPage: adminPage,
        mutation: async (beforeSubmit) => {
          await beforeSubmit();
          await protectedFileReleaseButton(lifecycle, protectedFileName).click();
        },
      });
      const released = await getP124State(world.orgId);
      const document = expectDefined(
        released.protectedDocuments.find(
          (item) =>
            item.employee_record_id === employeeRecordId &&
            (item.documents as { display_name: string }).display_name === protectedFileName,
        ),
        'the uploaded protected document',
      );
      expect(released.releases.filter((item) => item.personnel_document_id === document.id)).toHaveLength(1);

      await expectLiveWithin(visibleText(lifecycle, PEOPLE_LIFECYCLE_COPY.noOpenRequirements), {
        label: 'employee acknowledgement reflected in manager lifecycle',
        actingPage: employeePage,
        mutation: async (beforeSubmit) => {
          await beforeSubmit();
          await acknowledgeRequirementButton(employeePage).click();
        },
      });
      await confirmReceiptButton(employeePage).click();
      await expect(receiptConfirmedBanner(employeePage)).toBeVisible();
      // A click dispatches the action; only the persisted receipts prove completion.
      await expect
        .poll(
          async () =>
            (await getP124State(world.orgId)).acknowledgements
              .filter((item) => item.employee_record_id === employeeRecordId)
              .map((item) => item.acknowledgement_kind)
              .sort(),
          { message: 'Both exact employee receipts are persisted after one submission each' },
        )
        .toEqual(['document_received', 'requirement_completed']);
    });

    await test.step('Activate, suspend and reactivate the organization access', async () => {
      for (const [transition, reason, shown] of [
        ['activate_now', 'Kontrollierten Zugang starten', 'active'],
        ['suspend_now', 'Sofortige Organisationssperre', 'suspended'],
        ['reactivate', 'Zugang kontrolliert reaktiviert', 'active'],
      ] as const) {
        await changeOrganizationAccess(adminPage, transition, reason);
        await expect(visibleText(lifecycle, ACCESS_STATE_LABELS[shown])).toBeVisible({ timeout: 15_000 });
        if (transition === 'suspend_now') {
          await employeePage.goto('/aufgaben');
          await expect(employeePage).not.toHaveURL(/\/aufgaben/, { timeout: 15_000 });
        }
      }
      const state = await getP124State(world.orgId);
      expect(
        state.accessTransitions
          .filter((item) => item.employee_record_id === employeeRecordId)
          .map((item) => item.transition_kind),
      ).toEqual(['activate_now', 'suspend_now', 'reactivate']);
    });

    await test.step('Keep the protected file out of the library and export the working state', async () => {
      await adminPage.goto('/dokumente');
      await expect(textInDom(adminPage, protectedFileName)).toHaveCount(0);
      await openMemberDetailFromList(adminPage, employeeName);
      const download = adminPage.waitForEvent('download');
      await exportWorkingStateButton(lifecycle).click();
      expect((await download).suggestedFilename()).toContain(employeeRecordId);
    });
  });
});
