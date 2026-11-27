import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet } from '../acceptance-sets';
import { invoiceDeliverySeed, parseDeliverySeed } from '../invoice-delivery-fixtures';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';

async function unclearPage(world: TestWorld): Promise<SurfaceDestination> {
  const seed = invoiceDeliverySeed(world, 'delivered-unclear');
  const { id, heading } = parseDeliverySeed(await surfaceFixture(world, seed.name, seed.create));
  return { route: `/rechnungen/${id}`, heading };
}

const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;

/**
 * „Versand“ on an issued invoice whose email got no answer on its first
 * attempt and failed on its retry: the row stays unclear, with the failure as
 * „Letzter Versuch“, for Büro and Admin. A field worker gets no route, row or
 * action (lib/invoices/delivery-boundaries.test.ts).
 */
acceptanceSet({
  id: 'invoice-delivery-unclear-2026-11-27',
  captures: [
    {
      id: 'buero-versand-unklar',
      role: 'buero',
      route: '/rechnungen/[invoiceId]',
      view: { kind: 'page' },
      destination: unclearPage,
      ...both,
    },
    {
      id: 'admin-versand-unklar',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: { kind: 'page' },
      destination: unclearPage,
      ...both,
    },
  ],
  standalone: [],
});
