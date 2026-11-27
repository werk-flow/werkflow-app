import type { Locator } from '@playwright/test';
import { openRemainingP123Accounts } from '../../../golden/support/db/personnel';
import type { TestWorld } from '../../../golden/support/world';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#358 of 2026-11-26: the adjustment forms take
 * „Stunden (Std:Min)“, and plain minutes mark the field. The set opens every
 * account first, so it sorts after the sets that show the missing accounts.
 */
async function openedAccounts(world: TestWorld): Promise<SurfaceDestination> {
  await openRemainingP123Accounts({
    organizationId: world.orgId,
    actorUserId: world.users.admin.id,
    openedOn: '2026-11-01',
  });
  return { route: '/zeiterfassung/einstellungen' };
}

/** Types plain minutes into the first shown hours field and submits it as a correction. */
async function refusedMinutes(scope: Locator): Promise<void> {
  const hours = scope.getByRole('textbox', { name: /^Stunden der Korrektur für / }).filter({ visible: true });
  await hours.first().fill('750');
  await scope
    .getByRole('textbox', { name: /^Korrekturgrund für / })
    .filter({ visible: true })
    .first()
    .fill('Übertrag aus dem Altsystem');
  await scope
    .getByRole('button', { name: 'Korrektur', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await hours.first().and(scope.locator('[aria-invalid="true"]')).waitFor();
}

function zeitkontoHoursCaptures(): OpenSet {
  return {
    id: 'zeitkonto-hours-2026-11-26',
    captures: [
      {
        id: 'admin-zeitkonto-korrigieren',
        role: 'admin',
        route: '/zeiterfassung/einstellungen',
        view: { kind: 'page' },
        destination: openedAccounts,
        act: refusedMinutes,
        widths: [1280, 375],
        schemes: ['light', 'dark'],
        reveal: 'Zeitkonto korrigieren',
      },
    ],
    standalone: [],
  };
}

acceptanceSet(zeitkontoHoursCaptures());
