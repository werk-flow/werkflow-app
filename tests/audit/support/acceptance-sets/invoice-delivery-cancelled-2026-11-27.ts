import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet } from '../acceptance-sets';
import { invoiceDeliverySeed, parseDeliverySeed } from '../invoice-delivery-fixtures';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';

const cancelledPage =
  (state: 'cancelled' | 'cancelled-delivered') =>
  async (world: TestWorld): Promise<SurfaceDestination> => {
    const seed = invoiceDeliverySeed(world, state);
    const { id, heading } = parseDeliverySeed(await surfaceFixture(world, seed.name, seed.create));
    return { route: `/rechnungen/${id}`, heading };
  };

const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;

/**
 * „Versand“ on a cancelled invoice, read-only: its earlier sends with their
 * reasons (Büro), and a note when it never went out (Admin). A field worker
 * gets no route, row or action (lib/invoices/delivery-boundaries.test.ts).
 */
acceptanceSet({
  id: 'invoice-delivery-cancelled-2026-11-27',
  captures: [
    {
      id: 'buero-storniert-versand-liste',
      role: 'buero',
      route: '/rechnungen/[invoiceId]',
      view: { kind: 'page' },
      destination: cancelledPage('cancelled-delivered'),
      ...both,
    },
    {
      id: 'admin-storniert-nicht-versendet',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: { kind: 'page' },
      destination: cancelledPage('cancelled'),
      ...both,
    },
  ],
  standalone: [],
});
