import { randomUUID } from 'node:crypto';
import { draftAmounts } from '../../../../lib/invoices/amounts';
import type { InvoiceLineValues } from '../../../../lib/invoices/types';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

/**
 * A draft of „Haustechnik Sonnenberg“ with a line from a Leistung, a line
 * from an article that was archived since, and a free line, saved as the
 * editor saves them. Returns the draft's id.
 */
async function seedSourcedDraft(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-invoice-line-sources', async () => {
    const admin = createAdminClient();
    const orgId = world.orgId;
    const clientId = randomUUID();
    const leistungId = randomUUID();
    const articleId = randomUUID();
    await admin
      .from('clients')
      .insert({ id: clientId, organization_id: orgId, name: `Hausverwaltung Lindenhof ${world.runId}` })
      .throwOnError();
    await admin
      .from('leistungen')
      .insert({
        id: leistungId,
        organization_id: orgId,
        // Not `L-<runId>`: the Leistung price dialog's opener seeds that number in the same world.
        leistung_number: `RE-${world.runId}`,
        name: 'Monteurstunde Geselle',
        description: 'Arbeitszeit vor Ort',
        kind: 'arbeit',
        unit: 'hour',
        tax_rate_basis_points: 1900,
      })
      .throwOnError();
    await admin
      .from('inventory_items')
      .insert({
        id: articleId,
        organization_id: orgId,
        name: 'Kupferrohr 15 mm',
        item_type: 'material',
        unit: 'meter',
        internal_sku: 'KR-15',
        is_active: false,
      })
      .throwOnError();
    const { data: invoiceId } = await admin
      .rpc(
        'create_invoice',
        rpcArgs('create_invoice', {
          p_actor_id: world.users.buero.id,
          p_organization_id: orgId,
          p_attempt_key: randomUUID(),
          p_client_id: clientId,
          p_work_kind: null,
          p_work_id: null,
        }),
      )
      .throwOnError();
    // 2 h × 72,50 € and 3 m × 12,34 € per 10 m at 19 %, a free line of 45,00 € at 7 %.
    const lines = [
      {
        ...line('Monteurstunde Geselle', '2', 'hour', 7250, 1, 1900),
        description: 'Arbeitszeit vor Ort',
        source: { kind: 'leistung', id: leistungId },
      },
      {
        ...line('Kupferrohr 15 mm', '3', 'meter', 1234, 10, 1900),
        source: { kind: 'article', id: articleId },
      },
      { ...line('Entsorgung Altgerät', '1', 'flat_rate', 4500, 1, 700), source: null },
    ];
    // The editor's own calculation, so the stored amounts cannot drift from the lines.
    const amounts = draftAmounts(lines);
    await admin
      .rpc('save_invoice_draft', {
        p_actor_id: world.users.buero.id,
        p_organization_id: orgId,
        p_invoice_id: invoiceId,
        p_expected_version: 1,
        p_attempt_key: randomUUID(),
        p_terms: {
          serviceStart: '2026-11-16',
          serviceEnd: '2026-11-16',
          paymentDueDays: 14,
          discountDays: null,
          discountBasisPoints: null,
          orderReference: '',
          buyerReference: '',
          openingText: '',
          closingText: '',
        },
        p_lines: lines.map((value, index) => ({
          ...value,
          taxCategory: 'S',
          netCents: amounts.lineNetCents[index] ?? 0,
        })),
        p_totals: amounts.totals,
      })
      .throwOnError();
    return invoiceId;
  });
}

function line(
  name: string,
  quantity: string,
  unit: string,
  unitPriceCents: number,
  priceQuantity: InvoiceLineValues['priceQuantity'],
  taxRateBasisPoints: InvoiceLineValues['taxRateBasisPoints'],
): InvoiceLineValues {
  return { name, description: '', quantity, unit, unitPriceCents, priceQuantity, taxRateBasisPoints };
}

async function sourcedDraft(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/rechnungen/${await seedSourcedDraft(world)}`, heading: 'Rechnungsentwurf' };
}

const ALL = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
const PAGE = { kind: 'page' } as const;

/**
 * werk-flow/werkflow-planning#483 of 2026-11-17: the draft editor with lines
 * from the catalog and „Aus dem Katalog“, and „Rechnung erstellen“ on the
 * customer, job, project and Servicefall pages, with the dialog it opens.
 * A field worker's job page offers no invoice
 * (lib/testing/fixtures/invoice-line-source-boundaries.ts refuses the read).
 */
function captures(): OpenSet {
  return {
    id: 'invoice-line-sources-2026-11-17',
    captures: [
      {
        id: 'admin-entwurf-katalog',
        role: 'admin',
        route: '/rechnungen/[invoiceId]',
        view: PAGE,
        destination: sourcedDraft,
        ...ALL,
      },
      { id: 'admin-kunde', role: 'admin', route: '/kunden/[clientId]', view: PAGE, ...ALL },
      { id: 'admin-auftrag', role: 'admin', route: '/auftraege/[jobNumber]', view: PAGE, ...ALL },
      { id: 'admin-projekt', role: 'admin', route: '/auftraege/projekt/[projectNumber]', view: PAGE, ...ALL },
      { id: 'admin-servicefall', role: 'admin', route: '/service/faelle/[caseNumber]', view: PAGE, ...ALL },
      {
        id: 'buero-auftrag-rechnung-erstellen',
        role: 'buero',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'dialog', opener: 'commercial.invoice' },
        ...ALL,
      },
      {
        id: 'employee-auftrag',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: PAGE,
        widths: [375],
        schemes: ['light'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(captures());
