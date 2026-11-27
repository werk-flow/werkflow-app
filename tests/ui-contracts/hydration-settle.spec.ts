import { expect, test, type Locator, type Page } from '@playwright/test';
import { openHydrationFixture } from './open-fixture';

// A component hydrated inside a Suspense boundary runs its mount effects at
// idle priority. While a route transition stays pending, an idle update from
// such an effect waits, and React rebases every later update of the same hook
// on each render. A functional update then yields a new array on every render;
// an effect keyed on it that sets state commits forever. The field work pack's
// instruction card did so after a flash-param `router.replace`, and the main
// thread stayed busy for as long as the page was open.

async function openHydratedPage(
  page: Page,
  name: 'instruction-hydration' | 'auftraege-hydration',
): Promise<void> {
  await openHydrationFixture(page, name, () => {
    const commits = { count: 0 };
    Object.assign(window, {
      hydrationCommits: commits,
      // React reports every root commit to an installed DevTools hook, in production builds too.
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        inject: () => 1,
        checkDCE: () => undefined,
        onCommitFiberRoot: () => {
          commits.count += 1;
        },
        onCommitFiberUnmount: () => undefined,
        onPostCommitFiberRoot: () => undefined,
      },
    });
  });
  // The boundary hydrated, and its mount effect started the pending transition.
  await expect(page).toHaveTitle('Route wird geladen');
}

// Once the change is on screen, the page commits nothing more for thirty
// animation frames. The loop committed thousands of times per second.
async function expectSettledAfterChange(page: Page, changed: Locator): Promise<void> {
  await page.evaluate(() => window.hydrationContract.change());
  await expect(changed).toBeVisible();
  const commitsAfterSettle = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const counter = window.hydrationCommits;
        const start = counter.count;
        let frames = 0;
        const onFrame = (): void => {
          frames += 1;
          if (frames === 30) resolve(counter.count - start);
          else requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      }),
  );
  expect(commitsAfterSettle, 'React commits after the change settled').toBe(0);
}

test('a hydrated instruction list settles after a server refresh during a pending route transition', async ({
  page,
}) => {
  await openHydratedPage(page, 'instruction-hydration');
  await expectSettledAfterChange(
    page,
    page.getByRole('main').getByText('Absperrventil prüfen (aktualisiert)'),
  );
});

test('a hydrated Aufträge list settles after an own-action echo during a pending route transition', async ({
  page,
}) => {
  await openHydratedPage(page, 'auftraege-hydration');
  await expectSettledAfterChange(
    page,
    page.getByRole('status', { name: 'Eigene Änderung' }).getByText('übernommen, 0 Projekte'),
  );
});
