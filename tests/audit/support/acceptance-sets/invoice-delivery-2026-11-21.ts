import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { invoiceDeliverySeed, parseDeliverySeed } from '../invoice-delivery-fixtures';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';

const invoicePage =
  (state: 'fresh' | 'delivered') =>
  async (world: TestWorld): Promise<SurfaceDestination> => {
    const seed = invoiceDeliverySeed(world, state);
    const { id, heading } = parseDeliverySeed(await surfaceFixture(world, seed.name, seed.create));
    return { route: `/rechnungen/${id}`, heading };
  };

type SetCapture = OpenSet['captures'][number];
const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
const page = { kind: 'page' } as const;

/**
 * werk-flow/werkflow-planning#458 of 2026-11-21: „Versand“ on an issued
 * invoice, never sent (Admin) and sent, failed with „Erneut senden“ and
 * marked as sent by post (Büro); the email dialog with its proposed
 * recipient, subject and text, and the manual dialog. A field worker gets no
 * route, row or action (lib/invoices/delivery-boundaries.test.ts).
 */
function captures(): SetCapture[] {
  return [
    {
      id: 'admin-versand-leer',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: page,
      destination: invoicePage('fresh'),
      ...both,
    },
    {
      id: 'buero-versand-liste',
      role: 'buero',
      route: '/rechnungen/[invoiceId]',
      view: page,
      destination: invoicePage('delivered'),
      ...both,
    },
    {
      id: 'admin-per-e-mail-senden',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: { kind: 'dialog', opener: 'commercial.invoice-send' },
      destination: invoicePage('fresh'),
      ...both,
    },
    {
      id: 'admin-manuell-versendet',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: { kind: 'dialog', opener: 'commercial.invoice-sent-manually' },
      destination: invoicePage('fresh'),
      ...both,
    },
  ];
}

acceptanceSet({ id: 'invoice-delivery-2026-11-21', captures: captures(), standalone: [] });
