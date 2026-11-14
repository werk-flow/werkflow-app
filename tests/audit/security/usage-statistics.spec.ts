import { expect, test } from '../support/fixtures';
import {
  clockInLauncher,
  clockOut,
  clockStartSheet,
  clockStatus,
} from '../../golden/support/steps/time-tracking';
import { startWorkAction } from '../support/time-outbox';

// Usage statistics leave only from WerkFlow's server (werk-flow/werkflow-planning#280,
// docs/technical/security.md#usage-statistics): no PostHog script runs in the browser, so
// nothing is stored on or read from the device for analytics. A counted workflow step,
// clocking in and out, makes no browser request to PostHog.

test('a counted workflow step sends nothing to PostHog from the browser @AUDIT-SECURITY-USAGE-STATISTICS', async ({
  employeePage: page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  await test.step('the employee clocks in and out', async () => {
    await page.goto('/dashboard');
    await clockInLauncher(page).click();
    await startWorkAction(clockStartSheet(page)).click();
    await expect(clockStatus(page)).toBeVisible();
    await clockOut(page);
  });

  await test.step('no request went to PostHog', async () => {
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter((url) => /posthog/i.test(url))).toEqual([]);
  });
});
