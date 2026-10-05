import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.clock.install({ time: new Date('2026-09-30T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-30T10:00:01Z'));
  await page.route('http://localhost/ui-contracts', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'planning-options';
  });
  await page.addScriptTag({ path: bundle });
});

test('failed continuation retries the same page and selected records survive another search', async ({
  page,
}) => {
  await page.getByRole('combobox', { name: 'Mitarbeiter' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(1);
  await page.evaluate(() =>
    window.planningOptionContract.resolve(
      0,
      [
        {
          value: '00000000-0000-4000-8000-000000000010',
          label: 'Erste Person',
          description: undefined,
          userId: null,
        },
      ],
      [],
      true,
    ),
  );
  await page.getByRole('button', { name: 'Weitere Ergebnisse laden' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests[1]?.offset)).toBe(50);
  await page.evaluate(() => window.planningOptionContract.reject(1));
  await expect(page.getByRole('alert')).toHaveText('Die Auswahl konnte nicht geladen werden.');
  await page.getByRole('button', { name: 'Weitere Ergebnisse laden' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests[2]?.offset)).toBe(50);
  await page.evaluate(() =>
    window.planningOptionContract.resolve(
      2,
      [
        {
          value: '00000000-0000-4000-8000-000000000011',
          label: 'Zweite Person',
          description: undefined,
          userId: null,
        },
      ],
      [],
      false,
    ),
  );
  await page.getByRole('option', { name: 'Zweite Person' }).click();
  await expect(page.getByLabel('Auswahl', { exact: true })).toHaveText(
    '00000000-0000-4000-8000-000000000011',
  );
  await page.getByRole('textbox', { name: 'Suchen…' }).fill('anders');
  await page.clock.runFor(151);
  const index = await page.evaluate(() => window.planningOptionContract.requests.length - 1);
  expect(
    await page.evaluate((index) => window.planningOptionContract.requests[index]?.selectedIds, index),
  ).toEqual(['00000000-0000-4000-8000-000000000011']);
  await page.evaluate(
    (index) =>
      window.planningOptionContract.resolve(
        index,
        [],
        [
          {
            value: '00000000-0000-4000-8000-000000000011',
            label: 'Zweite Person',
            description: undefined,
            userId: null,
          },
        ],
      ),
    index,
  );
  await expect(page.getByLabel('Auswahl', { exact: true })).toHaveText(
    '00000000-0000-4000-8000-000000000011',
  );
});

test('superseded search is aborted and scope changes restart pagination without old choices', async ({
  page,
}) => {
  await page.getByRole('combobox', { name: 'Mitarbeiter' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(1);
  await page.getByRole('textbox', { name: 'Suchen…' }).fill('neu');
  await page.clock.runFor(151);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(2);
  expect(await page.evaluate(() => window.planningOptionContract.requests[0]?.signal?.aborted)).toBe(true);
  await page.evaluate(() =>
    window.planningOptionContract.resolve(
      1,
      [
        {
          value: '00000000-0000-4000-8000-000000000012',
          label: 'Neue Person',
          description: undefined,
          userId: null,
        },
      ],
      [],
      true,
    ),
  );
  await page.evaluate(() =>
    window.planningOptionContract.resolve(0, [
      {
        value: '00000000-0000-4000-8000-000000000013',
        label: 'Alte Antwort',
        description: undefined,
        userId: null,
      },
    ]),
  );
  await expect(page.getByRole('option', { name: 'Neue Person' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Alte Antwort' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Weitere Ergebnisse laden' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(3);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  await page.evaluate(() =>
    window.planningOptionContract.resolve(2, [
      {
        value: '00000000-0000-4000-8000-000000000014',
        label: 'Antwort der alten Organisation',
        description: undefined,
        userId: null,
      },
    ]),
  );
  await page.getByRole('combobox', { name: 'Mitarbeiter' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(4);
  expect(await page.evaluate(() => window.planningOptionContract.requests[3]?.offset)).toBe(0);
  expect(await page.evaluate(() => window.planningOptionContract.requests[3]?.organizationId)).toBe(
    '00000000-0000-4000-8000-000000000002',
  );
  await expect(page.getByRole('option', { name: 'Antwort der alten Organisation' })).toHaveCount(0);
});

test('default recipients resolve once and a later search cannot restore a removed choice', async ({
  page,
}) => {
  // Change scope with a linked-user default before the first request starts.
  await page.evaluate(() => {
    window.planningOptionContract.defaults = ['00000000-0000-4000-8000-000000000003'];
  });
  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(1);
  await expect(page.getByLabel('Vorauswahl geladen')).toHaveText('false');
  await page.evaluate(() =>
    window.planningOptionContract.resolve(
      0,
      [],
      [
        {
          value: '00000000-0000-4000-8000-000000000004',
          label: 'Vorausgewählte Person',
          description: undefined,
          userId: '00000000-0000-4000-8000-000000000003',
        },
      ],
    ),
  );
  await expect(page.getByLabel('Auswahl', { exact: true })).toHaveText(
    '00000000-0000-4000-8000-000000000004',
  );
  await expect(page.getByLabel('Vorauswahl geladen')).toHaveText('true');
  await page.getByRole('combobox', { name: 'Mitarbeiter' }).click();
  await page.clock.runFor(1);
  // Opening re-reads the first page without defaults; a page that lacks the resolved default keeps it listed.
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(2);
  expect(await page.evaluate(() => window.planningOptionContract.requests[1]?.defaultUserIds)).toEqual([]);
  await page.evaluate(() =>
    window.planningOptionContract.resolve(1, [
      {
        value: '00000000-0000-4000-8000-000000000005',
        label: 'Andere Person',
        description: undefined,
        userId: null,
      },
    ]),
  );
  await expect(page.getByRole('option', { name: 'Andere Person' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Vorausgewählte Person' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('option', { name: 'Vorausgewählte Person' }).click();
  await expect(page.getByLabel('Auswahl', { exact: true })).toHaveText('');
  await page.getByRole('textbox', { name: 'Suchen…' }).fill('später');
  await page.clock.runFor(151);
  const index = await page.evaluate(() => window.planningOptionContract.requests.length - 1);
  expect(
    await page.evaluate((index) => window.planningOptionContract.requests[index]?.defaultUserIds, index),
  ).toEqual([]);
  await page.evaluate((index) => window.planningOptionContract.resolve(index, []), index);
  await expect(page.getByLabel('Auswahl', { exact: true })).toHaveText('');
});
