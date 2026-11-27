import type { Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { offerDeliverySeed, parseOfferDeliverySeed } from '../offer-delivery-fixtures';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';

const offerPage =
  (state: 'fresh' | 'delivered') =>
  async (world: TestWorld): Promise<SurfaceDestination> => {
    const seed = offerDeliverySeed(world, state);
    const { id, heading } = parseOfferDeliverySeed(await surfaceFixture(world, seed.name, seed.create));
    return { route: `/angebote/${id}`, heading };
  };

/** Opens the replaced revision's sends, which list read-only; the act runs once per width, so a later width finds it open. */
async function openReplacedRevision(scope: Locator): Promise<void> {
  const dialog = scope.page().getByRole('dialog', { name: 'Angebot versenden', exact: true });
  if (!(await dialog.isVisible()))
    await scope.getByRole('button', { name: 'Versand ansehen', exact: true }).click();
  await expect(dialog.getByText('Ersetzt durch Revision 2', { exact: false })).toBeVisible();
}

type SetCapture = OpenSet['captures'][number];
const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
const route = '/angebote/[offerId]' as const;
const overview = { kind: 'dialog', opener: 'commercial.offer-delivery' } as const;

/**
 * werk-flow/werkflow-planning#460 of 2026-11-27: „Versenden“ on each sent
 * revision of an offer sent twice; the newest revision's sends, never
 * emailed (Admin, with its loading and error states) and emailed, failed
 * with „Erneut senden“ (Büro); the email step with its proposed recipient,
 * subject and text; and the replaced revision's sends, read-only. The page
 * before the change is `offer-sending-2026-11-26`'s `<role>-revisionen`. A
 * field worker gets no route or action (lib/offers/delivery-boundaries.test.ts).
 */
function captures(): SetCapture[] {
  const fresh = { route, destination: offerPage('fresh'), ...both } as const;
  const delivered = { route, destination: offerPage('delivered'), ...both } as const;
  return [
    { id: 'admin-revisionen', role: 'admin', ...fresh, view: { kind: 'page' } },
    { id: 'admin-versand-leer', role: 'admin', ...fresh, view: overview },
    {
      id: stateCaptureId('admin-versand-leer', 'loading'),
      role: 'admin',
      ...fresh,
      view: overview,
      state: 'loading',
    },
    {
      id: stateCaptureId('admin-versand-leer', 'error'),
      role: 'admin',
      ...fresh,
      view: overview,
      state: 'error',
    },
    {
      id: 'buero-per-e-mail-senden',
      role: 'buero',
      ...fresh,
      view: { kind: 'dialog', opener: 'commercial.offer-delivery-email' },
    },
    { id: 'buero-versand-liste', role: 'buero', ...delivered, view: overview },
    {
      id: 'buero-versand-ersetzt',
      role: 'buero',
      ...delivered,
      view: { kind: 'page' },
      act: openReplacedRevision,
    },
  ];
}

acceptanceSet({ id: 'offer-delivery-2026-11-27', captures: captures(), standalone: [] });
