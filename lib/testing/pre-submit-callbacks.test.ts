import { expect, test } from 'bun:test';
import type { Page } from '@playwright/test';
import { updateInstalledEquipmentModel, updateServiceCaseViaDialog } from '../../tests/golden/support/steps';

function pageBeforeSubmission(submit: () => Promise<void>): Page {
  const dialog = {
    getByLabel: () => ({ fill: async () => {} }),
    locator: () => ({ fill: async () => {} }),
    getByRole: () => ({ click: submit }),
  };
  // Only the interactions before submission are available. Later assertions
  // need a real browser and are intentionally outside this callback test.
  return {
    getByRole: (role: string) => role === 'dialog' ? dialog : { click: async () => {} },
  } as unknown as Page;
}

test('async setup rejection prevents equipment and service submission', async () => {
  const failure = new Error('Observer setup failed');
  let submissions = 0;
  const page = pageBeforeSubmission(async () => { submissions += 1; });
  const beforeSubmit = async (): Promise<void> => {
    await Promise.resolve();
    throw failure;
  };
  await expect(updateInstalledEquipmentModel(page, 'Model', 'Reason', beforeSubmit)).rejects.toBe(failure);
  await expect(updateServiceCaseViaDialog(page, { reason: 'Reason', beforeSubmit })).rejects.toBe(failure);
  expect(submissions).toBe(0);
});

test('the actual helper waits for async setup before clicking submit', async () => {
  const submitBoundary = new Error('Submit reached');
  const events: string[] = [];
  let ready!: () => void;
  let completeSetup!: () => void;
  const started = new Promise<void>((resolveStarted) => { ready = resolveStarted; });
  const setup = new Promise<void>((resolveSetup) => { completeSetup = resolveSetup; });
  const page = pageBeforeSubmission(async () => { events.push('submit'); throw submitBoundary; });
  const result = updateInstalledEquipmentModel(page, 'Model', 'Reason', async () => {
    events.push('setup-start');
    ready();
    await setup;
    events.push('setup-complete');
  }).then(() => null, (error: unknown) => error);
  await started;
  expect(events).toEqual(['setup-start']);
  completeSetup();
  expect(await result).toBe(submitBoundary);
  expect(events).toEqual(['setup-start', 'setup-complete', 'submit']);
});
