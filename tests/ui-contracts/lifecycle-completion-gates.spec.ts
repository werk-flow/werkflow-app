import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { workTransitionActionLabel, type WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import { workLifecycleErrorMessage } from '@/components/auftraege/lifecycle/work-lifecycle-messages';
import { RUNNING_CLOCK_STATE } from './clock-state-fixture';

declare global {
  interface Window {
    markClockTransitioned: () => Promise<void>;
  }
}

// A field worker whose „Ausführung abschließen“ waits sees each failing gate
// as one sentence with the step that clears it. When the worker's own running
// time is the only open point, one click ends it and completes execution.

// The clock state's schema takes only a UUID as job id.
const JOB_ID = '40000000-0000-4000-8000-000000000001';
const OPEN_GATES = {
  incompleteRequiredInstructions: 0,
  reopenedInstructionPredecessors: 0,
  incompleteInstructionEvidence: 0,
  openBlockers: 0,
  openCompletionDependencies: 0,
  activeJobClocks: 0,
  incompleteProjectChildren: 0,
} satisfies Partial<WorkLifecycleSnapshot['gates']>;
const OWN_CLOCK_ON_JOB: LiveClockState = {
  ...RUNNING_CLOCK_STATE,
  activeJobId: JOB_ID,
  currentActivity: { kind: 'work', allocationKind: 'job', jobId: JOB_ID },
  resumeActivity: { kind: 'work', allocationKind: 'job', jobId: JOB_ID },
};
// Travel to the job is not time the server counts against completion.
const OWN_TRAVEL_TO_JOB: LiveClockState = {
  ...RUNNING_CLOCK_STATE,
  activeJobId: JOB_ID,
  currentActivity: {
    kind: 'travel',
    allocationKind: 'job',
    jobId: JOB_ID,
    travelRoute: 'company_to_site',
    travelRole: 'driver',
  },
};
const CLOCKED_OUT: LiveClockState = {
  ...RUNNING_CLOCK_STATE,
  status: 'clocked_out',
  isClockedIn: false,
  sessionId: null,
  currentSegmentId: null,
};

async function mountFieldCard(
  page: Page,
  gates: Partial<WorkLifecycleSnapshot['gates']>,
  clockStates: { initial: LiveClockState; afterTransition?: LiveClockState },
): Promise<void> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  let transitioned = false;
  await page.route('**/api/time-tracking-state?**', (route) =>
    route.fulfill({
      json: {
        success: true,
        state: transitioned ? (clockStates.afterTransition ?? clockStates.initial) : clockStates.initial,
      },
    }),
  );
  await page.exposeFunction('markClockTransitioned', () => {
    transitioned = true;
  });
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(
    ({ seededGates, jobId }) => {
      window.uiContractFixture = 'lifecycle-field';
      window.clockContract = { transitions: [], directResult: null, resolveTransition: null };
      window.uiContractLifecycleSeed = {
        targetId: jobId,
        executionState: 'in_progress',
        gates: {
          incompleteRequiredInstructions: 0,
          reopenedInstructionPredecessors: 0,
          incompleteInstructionEvidence: 0,
          openBlockers: 0,
          openStartDependencies: 0,
          openCompletionDependencies: 0,
          activeJobClocks: 0,
          incompleteProjectChildren: 0,
          measurementArtifacts: 0,
          openDefects: 0,
          pendingFormalApprovals: 0,
          requiredCustomerDecisions: 0,
          requiredSignatures: 0,
          artifactFacts: [],
          notAssessable: [],
          ...seededGates,
        },
      };
    },
    { seededGates: gates, jobId: JOB_ID },
  );
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
}

const completeButton = (page: Page) =>
  page.getByRole('button', { name: workTransitionActionLabel('in_progress', 'execution_complete') });
const openGates = (page: Page) => page.getByRole('region', { name: 'Vor dem Abschließen offen' });

test('a waiting completion names every failing gate with the step that clears it', async ({ page }) => {
  await mountFieldCard(
    page,
    {
      ...OPEN_GATES,
      activeJobClocks: 2,
      incompleteRequiredInstructions: 2,
      reopenedInstructionPredecessors: 1,
      incompleteInstructionEvidence: 1,
      openBlockers: 1,
      openCompletionDependencies: 3,
      incompleteProjectChildren: 1,
    },
    { initial: OWN_CLOCK_ON_JOB },
  );
  const gates = openGates(page);
  await expect(completeButton(page)).toBeDisabled();
  await expect(completeButton(page)).toHaveAttribute(
    'aria-describedby',
    (await gates.getAttribute('id')) ?? '',
  );
  await expect(gates.getByRole('listitem')).toHaveText([
    /^Deine Zeit und eine weitere Zeiterfassung laufen noch auf diesem Auftrag\.\s*Zeit beenden$/,
    /^2 Pflichtpunkte der Arbeitsanweisungen sind offen\.Hake sie unter „Arbeitsanweisungen & Notizen“ ab\.$/,
    /^Ein erledigter Punkt hängt an einem Vorgänger, der wieder offen ist\.Erledige den Vorgänger unter „Arbeitsanweisungen & Notizen“\.$/,
    /^Ein Pflichtnachweis fehlt\.Erfasse ihn unter „Arbeitsnachweise“/,
    /^Ein Blocker ist offen\.Blocker klären$/,
    /^3 Abschlussvoraussetzungen sind offen\.Voraussetzungen ansehen$/,
    /^Ein Auftrag des Projekts ist nicht abgeschlossen\.Schließe ihn zuerst ab\.$/,
  ]);
  await expect(gates.getByRole('link', { name: 'Blocker klären' })).toHaveAttribute('href', '#offene-punkte');
  await expect(page.getByRole('link', { name: 'Offene Punkte prüfen' })).toHaveAttribute(
    'href',
    `#${await gates.getAttribute('id')}`,
  );
});

for (const [viewer, clock] of [
  ['is clocked out', CLOCKED_OUT],
  ['travels to the job', OWN_TRAVEL_TO_JOB],
] as const) {
  test(`a colleague's running time holds completion while the viewer ${viewer}`, async ({ page }) => {
    await mountFieldCard(page, { ...OPEN_GATES, activeJobClocks: 1 }, { initial: clock });
    const gates = openGates(page);
    await expect(gates.getByRole('listitem')).toHaveText([
      'Auf diesem Auftrag läuft noch die Zeit einer anderen Person.Abschließen geht, sobald sie beendet ist.',
    ]);
    await expect(gates.getByRole('button')).toHaveCount(0);
  });
}

test('own running time as the only open point ends and completes in one click', async ({ page }) => {
  await mountFieldCard(
    page,
    { ...OPEN_GATES, activeJobClocks: 1 },
    { initial: OWN_CLOCK_ON_JOB, afterTransition: CLOCKED_OUT },
  );
  const endAndComplete = page.getByTestId('field-primary-next-action');
  await expect(endAndComplete).toHaveText('Zeit beenden und abschließen');
  await expect(page.getByRole('link', { name: 'Offene Punkte prüfen' })).toHaveCount(0);
  await endAndComplete.click();
  await expect(endAndComplete).toHaveAttribute('aria-busy', 'true');
  await expect
    .poll(() => page.evaluate(() => window.clockContract.transitions.map((input) => input.action)))
    .toEqual(['end']);
  // Completion waits for the clock to end.
  expect(await page.evaluate(() => window.uiContractLifecycle.transitions)).toBe(0);
  await page.evaluate(async () => {
    await window.markClockTransitioned();
    window.uiContractLifecycle.snapshot = {
      ...window.uiContractLifecycle.snapshot,
      gates: { ...window.uiContractLifecycle.snapshot.gates, activeJobClocks: 0 },
    };
    window.clockContract.resolveTransition?.();
  });
  // A completed field work pack reloads read-only with the confirmation flag.
  await page.waitForURL(/field_transition=updated/);
});

test('ending own time with another gate open drops the clock gate without a live event', async ({ page }) => {
  await mountFieldCard(
    page,
    { ...OPEN_GATES, activeJobClocks: 1, openBlockers: 1 },
    { initial: OWN_CLOCK_ON_JOB, afterTransition: CLOCKED_OUT },
  );
  const gates = openGates(page);
  await gates.getByRole('button', { name: 'Zeit beenden', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.clockContract.transitions.map((input) => input.action)))
    .toEqual(['end']);
  await page.evaluate(async () => {
    await window.markClockTransitioned();
    // The server's snapshot after the clock ended; no realtime event announces it.
    window.uiContractLifecycle.snapshot = {
      ...window.uiContractLifecycle.snapshot,
      gates: { ...window.uiContractLifecycle.snapshot.gates, activeJobClocks: 0 },
    };
    window.clockContract.resolveTransition?.();
  });
  await expect(gates.getByRole('listitem')).toHaveText(['Ein Blocker ist offen.Blocker klären']);
  expect(await page.evaluate(() => window.uiContractLifecycle.transitions)).toBe(0);
});

// A refused step shows its sentence inline at the gate list, not as a page banner.
async function expectInlineRefusal(page: Page, message: string): Promise<void> {
  const alerts = page.getByRole('alert').filter({ hasText: message });
  await expect(alerts).toHaveCount(1);
  await expect(page.getByTestId('work-lifecycle-card').getByRole('alert')).toHaveText(message);
}

test('a refused clock end shows inline and the worker retries at the same button', async ({ page }) => {
  await mountFieldCard(
    page,
    { ...OPEN_GATES, activeJobClocks: 1 },
    { initial: OWN_CLOCK_ON_JOB, afterTransition: CLOCKED_OUT },
  );
  const endAndComplete = page.getByTestId('field-primary-next-action');
  await page.evaluate(() => {
    window.clockContract.refuse = true;
  });
  await endAndComplete.click();
  await page.evaluate(() => window.clockContract.resolveTransition?.());
  await expectInlineRefusal(
    page,
    'Deine Zeit konnte nicht beendet werden. Prüfe sie unter „Meine Zeit“ und versuche es erneut.',
  );
  expect(await page.evaluate(() => window.uiContractLifecycle.transitions)).toBe(0);
  await page.evaluate(() => {
    window.clockContract.refuse = false;
  });
  await endAndComplete.click();
  // The retry clears the old sentence while it runs.
  await expect(page.getByTestId('work-lifecycle-card').getByRole('alert')).toHaveCount(0);
});

test('a refused completion after the clock ended shows inline', async ({ page }) => {
  await mountFieldCard(
    page,
    { ...OPEN_GATES, activeJobClocks: 1 },
    { initial: OWN_CLOCK_ON_JOB, afterTransition: CLOCKED_OUT },
  );
  await page.evaluate(() => {
    window.uiContractLifecycle.rejectTransition = true;
  });
  await page.getByTestId('field-primary-next-action').click();
  await page.evaluate(async () => {
    await window.markClockTransitioned();
    window.uiContractLifecycle.snapshot = {
      ...window.uiContractLifecycle.snapshot,
      gates: { ...window.uiContractLifecycle.snapshot.gates, activeJobClocks: 0 },
    };
    window.clockContract.resolveTransition?.();
  });
  await expectInlineRefusal(page, workLifecycleErrorMessage('work_transition_not_authorized'));
});
