import { test } from '../support/fixtures';
import { STANDALONE_SCREENS } from '../../../lib/testing/selection/standalone-route-inventory';
import { auditStandaloneScreen } from '../support/standalone-audit';

// Rendered audit of the screens outside the app shell (werkflow-design,
// "Checklist"): sign-in and sign-up, onboarding, the upgrade offer, the
// invitation error and the not-found page, each with its own session, at 375
// and 1280 px in both themes with axe and the sideways measures. The inventory
// in lib/testing/selection/standalone-route-inventory.ts names the screens.
// Tag: @AUDIT-LAYOUT-STANDALONE.

test.describe('@AUDIT-LAYOUT-STANDALONE screens outside the app shell fit and pass axe', () => {
  for (const screen of STANDALONE_SCREENS) {
    test(`${screen.session} ${screen.route}`, async ({ browser, baseURL, world }) => {
      await auditStandaloneScreen({ browser, baseURL, world, screen });
    });
  }
});
