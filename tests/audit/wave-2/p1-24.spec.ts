import { expect, test } from '../support/fixtures';
import { EMPLOYMENT_LIFECYCLE_LABELS } from '../../../lib/personnel/lifecycle';
import { getP124State, seedNoLoginPersonnelRecord } from '../../golden/support/db/personnel';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  accessControlButton,
  createPersonnelRecordViaDialog,
  PEOPLE_LIFECYCLE_COPY,
  personnelLifecycle,
  protectedFileReleaseButton,
  recordEmploymentTransition,
  uploadProtectedPersonnelFile,
} from '../../golden/support/steps/personnel';
import { datePickerDigits, testData, textInDom, visibleText } from '../../golden/support/steps/shared';

// Golden P1-24 walks one employee's onboarding, release, receipts and access.
// This audit keeps the future starter without login, the Büro role variant,
// the planned employment transition and the outsider's route denial. Visibility
// classes, outsider reads, replay and history are proven in
// supabase/tests/p1_24_people_lifecycle.sql.

const standardFileName = testData`personal-standard.txt`;
const restrictedFileName = testData`admin-vertraulich.txt`;

test.describe('P1-24 lifecycle audit @AUDIT-W2-P1-24 @AUDIT-W2', () => {
  test('keeps a future starter usable without login and separates protected classes for Büro', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const { id: noLoginRecordId } = await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Lina',
      lastName: `Lebenslauf-${world.runId}`,
      entryDateDigits: datePickerDigits(ownedBerlinDateAtOffset('p1-24', 125)),
    });
    await adminPage.goto(`/mitarbeiter/${noLoginRecordId}`);
    const lifecycle = personnelLifecycle(adminPage);
    await expect(visibleText(lifecycle, PEOPLE_LIFECYCLE_COPY.noAccessRule)).toBeVisible();
    await expect(visibleText(lifecycle, PEOPLE_LIFECYCLE_COPY.noPlanDerived)).toBeVisible();

    await uploadProtectedPersonnelFile(adminPage, {
      fileName: standardFileName,
      content: 'P1-24 audit Personalstammunterlage',
      documentType: 'Personalstammunterlage',
    });
    await uploadProtectedPersonnelFile(adminPage, {
      fileName: restrictedFileName,
      content: 'P1-24 audit Vertrauliche Vereinbarung',
      documentType: 'Vertrauliche Vereinbarung',
      accessClass: 'admin_restricted',
    });
    // A person without login cannot receive a release.
    for (const fileName of [standardFileName, restrictedFileName]) {
      await expect(protectedFileReleaseButton(lifecycle, fileName)).toBeDisabled();
    }
    expect(
      (await getP124State(world.orgId)).protectedDocuments.filter(
        (item) => item.employee_record_id === noLoginRecordId,
      ),
    ).toHaveLength(2);

    await bueroPage.goto(`/mitarbeiter/${noLoginRecordId}`);
    const bueroLifecycle = personnelLifecycle(bueroPage);
    await expect(visibleText(bueroLifecycle, standardFileName)).toBeVisible();
    await expect(textInDom(bueroPage, restrictedFileName)).toHaveCount(0);
    await expect(accessControlButton(bueroLifecycle)).toHaveCount(0);
  });

  test('records a planned employment transition and denies the outsider the record', async ({
    adminPage,
    outsiderPage,
    world,
  }) => {
    const entryDate = ownedBerlinDateAtOffset('p1-24', 126);
    const recordId = await seedNoLoginPersonnelRecord({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      firstName: 'Paul',
      lastName: `Eintritt-${world.runId}`,
      entryDate,
    });
    await adminPage.goto(`/mitarbeiter/${recordId}`);
    const lifecycle = personnelLifecycle(adminPage);
    await recordEmploymentTransition(adminPage, {
      transition: 'plan_start',
      effectiveOn: entryDate,
      reason: 'Geplanter Eintritt ohne vorgezogenen Zugang',
    });
    await expect(visibleText(lifecycle, EMPLOYMENT_LIFECYCLE_LABELS.planned)).toBeVisible({
      timeout: 15_000,
    });
    const state = await getP124State(world.orgId);
    expect(state.employment.filter((item) => item.employee_record_id === recordId)).toMatchObject([
      { state: 'planned', scheduled_state: 'active' },
    ]);
    expect(
      state.employmentTransitions
        .filter((item) => item.employee_record_id === recordId)
        .map((item) => item.transition_kind),
    ).toEqual(['plan_start']);

    await outsiderPage.goto(`/mitarbeiter/${recordId}`);
    await expect(outsiderPage).not.toHaveURL(new RegExp(recordId), { timeout: 15_000 });
  });
});
