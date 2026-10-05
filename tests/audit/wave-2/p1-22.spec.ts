import { submitMissedTime } from '../support/time-corrections';
import { prepareSubmittedCorrections } from '../support/time-correction-fixtures';

import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { expect, test } from '../support/fixtures';
import { getTimeCorrectionState } from '../../golden/support/db/time-tracking';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { visibleText } from '../../golden/support/steps/shared';
import {
  answerCorrectionQuestion,
  approveSelectedCorrectionsButton,
  askCorrectionQuestion,
  correctionBatchReviewedText,
  TIME_CORRECTION_COPY,
  timeCorrectionCard,
  timeCorrectionStatus,
} from '../../golden/support/steps/time-tracking';

// Golden P1-22 owns the employee submission and the single approval. This audit
// keeps the clarification round trip, the Büro role variant and the batch
// review as users see them. Immutable revisions, event history, four-eyes
// rules, batch atomicity and tenant isolation are proven in
// supabase/tests/p1_22_time_corrections.sql.

async function requestIdForReason(organizationId: string, reason: string): Promise<string> {
  const state = await getTimeCorrectionState(organizationId);
  return expectDefined(
    state.revisions.find((revision) => revision.reason === reason),
    `the correction revision "${reason}"`,
  ).request_id;
}

test.describe('P1-22 correction review audit @AUDIT-W2-P1-22 @AUDIT-W2', () => {
  test('returns a correction for clarification and resubmits the answer', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const reason = `Korrektur mit Rückfrage ${world.runId}`;
    const [requestId] = await prepareSubmittedCorrections(world, [
      { date: ownedBerlinDateAtOffset('p1-22', 115), reason },
    ]);
    const clarificationRequestId = expectDefined(requestId, 'the prepared correction');

    await test.step('The manager asks a question', async () => {
      await adminPage.goto('/zeiterfassung?tab=approvals');
      await askCorrectionQuestion(
        timeCorrectionCard(adminPage, clarificationRequestId),
        'Bitte den fehlenden Einsatz genauer erläutern.',
      );
      // The card leaves with the click; the banner confirms the decision before the employee reads it.
      await expect(visibleText(adminPage, TIME_CORRECTION_COPY.decisionSaved)).toBeVisible({
        timeout: 20_000,
      });
      await expect(adminPage.getByTestId(`time-correction-${clarificationRequestId}`)).toHaveCount(0);
      expect(
        (await getTimeCorrectionState(world.orgId)).requests.find((row) => row.id === clarificationRequestId)
          ?.status,
      ).toBe('clarification_required');
    });

    await test.step('The employee answers and resubmits', async () => {
      await employeePage.goto('/zeiterfassung?tab=history');
      const responseCard = timeCorrectionCard(employeePage, clarificationRequestId);
      await expect(timeCorrectionStatus(responseCard, 'clarification_required')).toBeVisible();
      await answerCorrectionQuestion(responseCard, 'Notdiensteinsatz beim Kunden; Beginn und Ende geprüft.');
      await expect(timeCorrectionStatus(responseCard, 'submitted')).toBeVisible();
      const resubmitted = await getTimeCorrectionState(world.orgId);
      expect(resubmitted.requests.find((row) => row.id === clarificationRequestId)).toMatchObject({
        status: 'submitted',
        current_revision: 2,
      });
    });
  });

  test('applies a Büro correction for another person at once but keeps the own correction a request @READINESS', async ({
    bueroPage,
    world,
  }) => {
    const reason = `Direkte Büro-Korrektur ${world.runId}`;
    await submitMissedTime(bueroPage, {
      date: ownedBerlinDateAtOffset('p1-22', 116),
      reason,
      personName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await expect(visibleText(bueroPage, TIME_CORRECTION_COPY.applied)).toBeVisible();
    const directRequestId = await requestIdForReason(world.orgId, reason);
    expect(
      (await getTimeCorrectionState(world.orgId)).requests.find((row) => row.id === directRequestId),
    ).toMatchObject({ status: 'approved', requested_by: world.users.buero.id });

    const selfReason = `Eigene Büro-Korrektur ${world.runId}`;
    await submitMissedTime(bueroPage, { date: ownedBerlinDateAtOffset('p1-22', 119), reason: selfReason });
    await expect(visibleText(bueroPage, TIME_CORRECTION_COPY.submittedForReview)).toBeVisible();
    const selfRequestId = await requestIdForReason(world.orgId, selfReason);
    expect(
      (await getTimeCorrectionState(world.orgId)).requests.find((row) => row.id === selfRequestId),
    ).toMatchObject({
      status: 'submitted',
      requested_by: world.users.buero.id,
      subject_user_id: world.users.buero.id,
    });
  });

  test('reviews two selected corrections in one batch', async ({ adminPage, world }) => {
    const requests = [
      { date: ownedBerlinDateAtOffset('p1-22', 117), reason: `Batch A ${world.runId}` },
      { date: ownedBerlinDateAtOffset('p1-22', 118), reason: `Batch B ${world.runId}` },
    ];
    const batchIds = await prepareSubmittedCorrections(world, requests);

    await adminPage.goto('/zeiterfassung?tab=approvals');
    for (const [index, requestId] of batchIds.entries()) {
      const card = timeCorrectionCard(adminPage, requestId);
      await expect(card).toContainText(expectDefined(requests[index], 'the prepared request').reason);
      await expect(card).toContainText(TIME_CORRECTION_COPY.noEntryBefore);
      await expect(card).toContainText('07:00');
      await expect(card).toContainText('09:30');
      await card.getByRole('checkbox').check();
    }
    await approveSelectedCorrectionsButton(adminPage).click();
    await expect(visibleText(adminPage, correctionBatchReviewedText(2))).toBeVisible();

    const after = await getTimeCorrectionState(world.orgId);
    expect(after.requests.filter((row) => batchIds.includes(row.id)).map((row) => row.status)).toEqual([
      'approved',
      'approved',
    ]);
  });
});
