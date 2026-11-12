import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import { formatDuration } from '@/lib/time-tracking/helpers';

async function mountBreakRuleWeek(page: Page): Promise<void> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  // Wednesday, 9 September 2026: the rule changed on Tuesday morning.
  await page.clock.install({ time: new Date('2026-09-09T10:00:00Z') });
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'break-rule-week';
  });
  await page.addScriptTag({ path: bundle });
}

function dayBar(page: Page, region: string, day: string) {
  return page.getByRole('region', { name: region, exact: true }).getByLabel(new RegExp(`^${day}: Anwesenheit`));
}

for (const region of ['Zeiterfassung', 'Mitarbeiter']) {
  test(`${region}: a break rule switched on midweek leaves Monday's numbers as they were`, async ({
    page,
  }) => {
    await mountBreakRuleWeek(page);

    // Monday ran under manual breaks: ten hours present, no break deducted.
    await expect(dayBar(page, region, 'Mo')).toHaveAttribute(
      'aria-label',
      `Mo: Anwesenheit ${formatDuration(600)}, Arbeitszeit ${formatDuration(480)}, Pause ${formatDuration(0)}, Überstunden ${formatDuration(120)}`,
    );
    // Tuesday ran under the new rule: its thirty minutes are deducted.
    await expect(dayBar(page, region, 'Di')).toHaveAttribute(
      'aria-label',
      `Di: Anwesenheit ${formatDuration(600)}, Arbeitszeit ${formatDuration(480)}, Pause ${formatDuration(30)}, Überstunden ${formatDuration(90)}`,
    );
  });
}

test('Zeiterfassung: a rule saved in another session rebuilds the open week, also without earlier versions', async ({
  page,
}) => {
  await mountBreakRuleWeek(page);
  const region = 'Zeiterfassung offen';
  await expect(dayBar(page, region, 'Di')).toHaveAttribute('aria-label', /, Pause 0 Min\.,/);

  // The page's server data arrives again with the saved rule; the week is not remounted.
  await page.getByRole('button', { name: 'Neue Regel übernehmen' }).click();

  // Tuesday ran under the rule switched on that morning; Monday keeps the manual rule.
  await expect(dayBar(page, region, 'Di')).toHaveAttribute(
    'aria-label',
    `Di: Anwesenheit ${formatDuration(600)}, Arbeitszeit ${formatDuration(480)}, Pause ${formatDuration(30)}, Überstunden ${formatDuration(90)}`,
  );
  await expect(dayBar(page, region, 'Mo')).toHaveAttribute('aria-label', /, Pause 0 Min\.,/);
});
