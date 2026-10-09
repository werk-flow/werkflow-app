import { expect, test } from '../support/fixtures';
import { clockStateTarget } from '../../golden/support/browser-observation';
import { getTimeCaptureState } from '../../golden/support/db/time-tracking';
import {
  beginWorkArtifact,
  closeWorkArtifactDialog,
  workArtifactAction,
  workArtifactEntry,
  workArtifactField,
  workArtifactVersion,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
import { jobInstructionItem, jobInstructionToggle, openFieldWorkPack } from '../../golden/support/steps/work';
import {
  checklistPointDone,
  enabledControl,
  fieldWorkPackReady,
  jobListEntry,
  jobListReady,
  seedChecklistPoints,
} from '../support/lab-journeys';
import { idleFrames, openLabSession, recordLabStep } from '../support/lab-recorder';
import { ensureTypicalProfile, MEASURED_VISIT_TITLE } from '../support/performance-profile';
import { clockSheetAction, openClockSheet, usableListCount } from '../support/performance-steps';

// Lab counts of the field worker's journeys (lib/testing/journeys.ts), on the
// typical profile at a phone width with a four-times slower CPU. Each step id
// is registered in lib/testing/lab-steps.ts; the runner compares every record
// with lib/testing/lab-count-references.json.

test.describe('Lab counts of the field worker @AUDIT-LAB-FIELD', () => {
  test("LAB-F1 the field worker opens today's job from the job list @AUDIT-LAB-F1", async ({
    browser,
    baseURL,
    world,
  }) => {
    await ensureTypicalProfile(world);
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.field.cold-start' });
    try {
      await recordLabStep(lab, 'lab.field.cold-start', {
        trigger: () => lab.page.goto('/auftraege'),
        usable: jobListReady(lab.page),
        rows: () => usableListCount(lab.page, 'auftraege'),
      });
      await recordLabStep(lab, 'lab.field.job-open', {
        trigger: () => jobListEntry(lab.page, MEASURED_VISIT_TITLE).click(),
        usable: fieldWorkPackReady(lab.page),
      });
      await expect(lab.page).toHaveURL(/\/auftraege\/PERF-[^/]+$/);
    } finally {
      await lab.dispose();
    }
  });

  test('LAB-F2 the field worker ticks a checklist point done @AUDIT-LAB-F2', async ({
    browser,
    baseURL,
    world,
  }) => {
    const { assignedJobNumber } = await ensureTypicalProfile(world);
    const point = `Prüfpunkt ${world.runId}`;
    await seedChecklistPoints({ world, jobNumber: assignedJobNumber, contents: [point] });
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.field.checklist-tick' });
    try {
      await openFieldWorkPack(lab.page, assignedJobNumber);
      const item = jobInstructionItem(lab.page, point);
      await expect(jobInstructionToggle(item, 'done')).toBeEnabled();
      await recordLabStep(lab, 'lab.field.checklist-tick', {
        trigger: () => jobInstructionToggle(item, 'done').click(),
        usable: enabledControl(jobInstructionToggle(item, 'open')),
      });
      expect(await checklistPointDone({ world, jobNumber: assignedJobNumber, content: point })).toBe(true);
    } finally {
      await lab.dispose();
    }
  });

  test('LAB-F3 the field worker saves a new Arbeitsnachweis @AUDIT-LAB-F3', async ({
    browser,
    baseURL,
    world,
  }) => {
    const { assignedJobNumber } = await ensureTypicalProfile(world);
    const title = `Bautagebuch ${world.runId}`;
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.field.evidence-add' });
    try {
      await openFieldWorkPack(lab.page, assignedJobNumber);
      const dialog = await beginWorkArtifact(lab.page, {
        kind: 'site_diary',
        title,
        summary: 'Leitungen im Bad freigelegt.',
      });
      await workArtifactField(dialog, 'progress').fill('Rohinstallation zur Hälfte fertig.');
      await recordLabStep(lab, 'lab.field.evidence-add', {
        trigger: () => workArtifactAction(dialog, 'saveDraft').click(),
        usable: workArtifactVersion(dialog, 1),
      });
      await closeWorkArtifactDialog(dialog);
      await expect(workArtifactEntry(lab.page, title)).toBeVisible();
    } finally {
      await lab.dispose();
    }
  });

  test('LAB-F4 the field worker clocks in, stays idle, and clocks out @AUDIT-LAB-F4', async ({
    browser,
    baseURL,
    world,
  }) => {
    await ensureTypicalProfile(world);
    const employee = world.users.employee;
    const sessionsBefore = (await getTimeCaptureState(world.orgId, employee.id)).sessions.length;
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.field.clock-in' });
    try {
      await lab.page.goto('/dashboard');
      await expect(clockStateTarget(lab.page, 'out').locator).toBeVisible();
      await openClockSheet(lab.page, false);
      await recordLabStep(lab, 'lab.field.clock-in', {
        trigger: () => clockSheetAction(lab.page, 'Arbeit starten').click(),
        usable: clockStateTarget(lab.page, 'in').locator,
      });
      await recordLabStep(lab, 'lab.field.idle-clocked-in', {
        trigger: () => idleFrames(lab.page),
        usable: clockStateTarget(lab.page, 'in').locator,
      });
      await openClockSheet(lab.page, true);
      await recordLabStep(lab, 'lab.field.clock-out', {
        trigger: () => clockSheetAction(lab.page, 'Erfassung beenden').click(),
        usable: clockStateTarget(lab.page, 'out').locator,
      });
    } finally {
      await lab.dispose();
    }
    const { sessions } = await getTimeCaptureState(world.orgId, employee.id);
    expect(sessions.length).toBe(sessionsBefore + 1);
    expect(sessions.every((session) => session.ended_at !== null)).toBe(true);
  });
});
