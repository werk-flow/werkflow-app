import { randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const CUSTOMER = 'WEG Lindenstraße 5';

/**
 * A WEG of „Haustechnik Sonnenberg“ and two drafts written as the office's
 * create and save write them: one with three lines at 19, 7 and 0 %, one
 * still empty. Returns the filled draft's id.
 */
async function seedInvoices(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'commercial.acceptance-invoices', async () => {
    const admin = createAdminClient();
    const orgId = world.orgId;
    const clientId = randomUUID();
    await admin
      .from('clients')
      .insert({
        id: clientId,
        organization_id: orgId,
        name: `${CUSTOMER} ${world.runId}`,
        address: 'Lindenstraße 5, 10115 Berlin',
      })
      .throwOnError();
    const create = () =>
      admin
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
    const { data: invoiceId } = await create();
    await create();
    // 1,5 h × 72,00 € and 3 m × 12,40 € at 19 %, 2 × 4,50 € at 7 %, a credit of 45,00 € at 0 %.
    await admin
      .rpc('save_invoice_draft', {
        p_actor_id: world.users.buero.id,
        p_organization_id: orgId,
        p_invoice_id: invoiceId,
        p_expected_version: 1,
        p_attempt_key: randomUUID(),
        p_terms: {
          serviceStart: '2026-11-02',
          serviceEnd: '2026-11-06',
          paymentDueDays: 14,
          discountDays: 7,
          discountBasisPoints: 200,
          orderReference: 'BE-4711',
          buyerReference: '',
          openingText: 'Vielen Dank für deinen Auftrag.',
          closingText: '',
        },
        p_lines: [
          line('Monteurstunde', '1.5', 'hour', 7200, 1900, 'S', 10800),
          line('Kupferrohr 15 mm', '3', 'meter', 1240, 1900, 'S', 3720),
          line('Fachbuch Heizung', '2', 'piece', 450, 700, 'S', 900),
          line('Gutschrift Anfahrt', '-1', 'flat_rate', 4500, 0, 'Z', -4500),
        ],
        p_totals: { lineNetCents: 10920, taxCents: 2822, grossCents: 13742 },
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
  taxRateBasisPoints: number,
  taxCategory: 'S' | 'Z',
  netCents: number,
) {
  return {
    name,
    description: '',
    quantity,
    unit,
    unitPriceCents,
    priceQuantity: 1,
    taxCategory,
    taxRateBasisPoints,
    netCents,
  };
}

async function invoiceList(world: TestWorld): Promise<SurfaceDestination> {
  await seedInvoices(world);
  return { route: `/rechnungen?q=${encodeURIComponent(world.runId)}` };
}

async function invoicePage(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/rechnungen/${await seedInvoices(world)}`, heading: 'Rechnungsentwurf' };
}

type SetCapture = OpenSet['captures'][number];

/**
 * werk-flow/werkflow-planning#456 of 2026-11-14: „Rechnungen“ empty, filled
 * and loading, „Rechnung erstellen“ and one draft's editor, for Admin and
 * Büro. A field worker is redirected (lib/invoices/action-boundaries.test.ts).
 * A failed read is a region the server renders, which no browser
 * interception can produce.
 */
function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return [
    { id: `${role}-liste`, role, route: '/rechnungen', view: page, destination: invoiceList, ...both },
    {
      id: stateCaptureId(`${role}-liste`, 'loading'),
      role,
      route: '/rechnungen',
      view: page,
      state: 'loading',
      ...both,
    },
    {
      id: `${role}-erstellen`,
      role,
      route: '/rechnungen',
      view: { kind: 'dialog', opener: 'commercial.invoice' },
      ...both,
    },
    {
      id: `${role}-entwurf`,
      role,
      route: '/rechnungen/[invoiceId]',
      view: page,
      destination: invoicePage,
      ...both,
    },
  ];
}

function invoiceCaptures(): OpenSet {
  return {
    id: 'invoices-2026-11-14',
    captures: [
      // Empty runs first: the filled captures seed the world's invoices.
      {
        id: 'admin-leer',
        role: 'admin',
        route: '/rechnungen',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      ...roleCaptures('admin'),
      ...roleCaptures('buero'),
    ],
    standalone: [],
  };
}

acceptanceSet(invoiceCaptures());
