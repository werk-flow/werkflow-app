import { expect, test } from 'bun:test';
import {
  saveInstalledEquipmentModelDialog,
  saveServiceCaseDialog,
} from '../../../tests/golden/support/steps/service';

// Only the interactions before submission are available. Later assertions
// need a real browser and are intentionally outside this callback test.
function dialogBeforeSubmission(submit: () => Promise<void>) {
  return {
    getByLabel: () => ({ fill: async () => {} }),
    locator: () => ({ fill: async () => {} }),
    getByRole: () => ({ click: submit }),
  };
}

test('async setup rejection prevents equipment and service submission', async () => {
  const failure = new Error('Observer setup failed');
  let submissions = 0;
  const dialog = dialogBeforeSubmission(async () => {
    submissions += 1;
  });
  const beforeSubmit = async (): Promise<void> => {
    await Promise.resolve();
    throw failure;
  };
  await expect(saveInstalledEquipmentModelDialog(dialog, 'Model', 'Reason', beforeSubmit)).rejects.toBe(
    failure,
  );
  await expect(saveServiceCaseDialog(dialog, { reason: 'Reason', beforeSubmit })).rejects.toBe(failure);
  expect(submissions).toBe(0);
});

test('the actual helper waits for async setup before clicking submit', async () => {
  const submitBoundary = new Error('Submit reached');
  const events: string[] = [];
  let ready!: () => void;
  let completeSetup!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    ready = resolveStarted;
  });
  const setup = new Promise<void>((resolveSetup) => {
    completeSetup = resolveSetup;
  });
  const dialog = dialogBeforeSubmission(async () => {
    events.push('submit');
    throw submitBoundary;
  });
  const result = saveInstalledEquipmentModelDialog(dialog, 'Model', 'Reason', async () => {
    events.push('setup-start');
    ready();
    await setup;
    events.push('setup-complete');
  }).then(
    () => null,
    (error: unknown) => error,
  );
  await started;
  expect(events).toEqual(['setup-start']);
  completeSetup();
  expect(await result).toBe(submitBoundary);
  expect(events).toEqual(['setup-start', 'setup-complete', 'submit']);
});
