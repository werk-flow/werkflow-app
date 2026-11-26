import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { invoiceChainSeed, parseInvoiceChain } from '../invoice-chain-fixtures';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';

type ChainPage = 'issued' | 'original' | 'storno' | 'correction';

/** The page of one invoice of the world's issued invoice or of its cancelled chain. */
const invoicePage =
  (which: ChainPage) =>
  async (world: TestWorld): Promise<SurfaceDestination> => {
    const seed = invoiceChainSeed(world, which === 'issued' ? 'issued' : 'cancelled');
    const chain = parseInvoiceChain(await surfaceFixture(world, seed.name, seed.create));
    if (which === 'issued' || which === 'original') {
      return { route: `/rechnungen/${chain.originalId}`, heading: `Rechnung ${chain.originalNumber}` };
    }
    if (which === 'storno' && chain.stornoId) {
      return {
        route: `/rechnungen/${chain.stornoId}`,
        heading: `Stornorechnung ${chain.stornoNumber ?? ''}`,
      };
    }
    if (which === 'correction' && chain.correctionId) {
      return { route: `/rechnungen/${chain.correctionId}`, heading: 'Rechnungsentwurf' };
    }
    throw new Error(`the invoice chain fixture has no ${which}`);
  };

/** The list after the chain exists: the original Storniert, „Storno zu“ and „Korrektur zu“. */
async function invoiceList(world: TestWorld): Promise<SurfaceDestination> {
  const seed = invoiceChainSeed(world, 'cancelled');
  await surfaceFixture(world, seed.name, seed.create);
  return { route: '/rechnungen', heading: 'Rechnungen' };
}

type SetCapture = OpenSet['captures'][number];
const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
const page = { kind: 'page' } as const;
const detail = { route: '/rechnungen/[invoiceId]' } as const;

/**
 * werk-flow/werkflow-planning#459 of 2026-11-17: an issued invoice with
 * „Korrigieren“ and „Stornieren“ and both dialogs; after „Korrigieren“ the
 * original Storniert with its chain, the Stornorechnung with its reason, the
 * correction draft, and the list. A field worker gets no route, row or action
 * (lib/invoices/cancel-boundaries.test.ts, supabase/tests/invoice_cancel.sql).
 */
function captures(): SetCapture[] {
  return [
    {
      id: 'admin-ausgestellt',
      role: 'admin',
      ...detail,
      view: page,
      destination: invoicePage('issued'),
      ...both,
    },
    {
      id: 'admin-stornieren',
      role: 'admin',
      ...detail,
      view: { kind: 'dialog', opener: 'commercial.invoice-cancel' },
      destination: invoicePage('issued'),
      ...both,
    },
    {
      id: 'admin-korrigieren',
      role: 'admin',
      ...detail,
      view: { kind: 'dialog', opener: 'commercial.invoice-correct' },
      destination: invoicePage('issued'),
      ...both,
    },
    {
      id: 'buero-storniert',
      role: 'buero',
      ...detail,
      view: page,
      destination: invoicePage('original'),
      ...both,
    },
    {
      id: 'buero-stornorechnung',
      role: 'buero',
      ...detail,
      view: page,
      destination: invoicePage('storno'),
      ...both,
    },
    {
      id: 'admin-korrektur',
      role: 'admin',
      ...detail,
      view: page,
      destination: invoicePage('correction'),
      ...both,
    },
    { id: 'buero-liste', role: 'buero', route: '/rechnungen', view: page, destination: invoiceList, ...both },
  ];
}

acceptanceSet({ id: 'invoice-cancel-2026-11-17', captures: captures(), standalone: [] });
