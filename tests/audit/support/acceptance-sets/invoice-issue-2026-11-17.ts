import { randomUUID } from 'node:crypto';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '../../../../lib/company-profile/profile';
import { getBusinessTodayIso } from '../../../../lib/date-time/berlin';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

const CUSTOMER = 'Hausverwaltung Lindenhof GmbH';

/** A snapshot of the shape the issue action stores; the page shows its recipient. */
const SNAPSHOT = {
  organizationName: 'Haustechnik Sonnenberg',
  profile: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
  files: { logo: null, stationery_first: null, stationery_following: null },
  buyer: {
    name: CUSTOMER,
    address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
  },
};

/**
 * A draft of „Haustechnik Sonnenberg“ with two lines, written as the office's
 * create and save write them; `issue` issues it through `issue_invoice`, and
 * `filed` registers a stand-in original, which files it, as the issue
 * action does after rendering. Returns the invoice id and the heading of its page.
 */
async function seedInvoice(
  world: TestWorld,
  state: 'draft' | 'pending' | 'filed',
): Promise<{ id: string; heading: string }> {
  const value = await surfaceFixture(world, `commercial.acceptance-invoice-${state}`, async () => {
    const admin = createAdminClient();
    const orgId = world.orgId;
    const actor = world.users.buero.id;
    const clientId = randomUUID();
    await admin
      .from('clients')
      .insert({
        id: clientId,
        organization_id: orgId,
        name: `${CUSTOMER} ${state} ${world.runId}`,
        address: 'Hofweg 1, 10117 Berlin',
      })
      .throwOnError();
    const { data: invoiceId } = await admin
      .rpc(
        'create_invoice',
        rpcArgs('create_invoice', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_attempt_key: randomUUID(),
          p_client_id: clientId,
          p_work_kind: null,
          p_work_id: null,
        }),
      )
      .throwOnError();
    await admin
      .rpc('save_invoice_draft', {
        p_actor_id: actor,
        p_organization_id: orgId,
        p_invoice_id: invoiceId,
        p_expected_version: 1,
        p_attempt_key: randomUUID(),
        p_terms: {
          serviceStart: '2026-11-02',
          serviceEnd: '2026-11-02',
          paymentDueDays: 14,
          discountDays: null,
          discountBasisPoints: null,
          orderReference: 'BE-4711',
          buyerReference: '',
          openingText: 'Vielen Dank für deinen Auftrag.',
          closingText: '',
        },
        // 1,5 h × 72,00 € and 3 m × 12,40 € at 19 %.
        p_lines: [
          {
            name: 'Monteurstunde',
            description: '',
            quantity: '1.5',
            unit: 'hour',
            unitPriceCents: 7200,
            priceQuantity: 1,
            taxCategory: 'S',
            taxRateBasisPoints: 1900,
            netCents: 10800,
          },
          {
            name: 'Kupferrohr 15 mm',
            description: '',
            quantity: '3',
            unit: 'meter',
            unitPriceCents: 1240,
            priceQuantity: 1,
            taxCategory: 'S',
            taxRateBasisPoints: 1900,
            netCents: 3720,
          },
        ],
        p_totals: { lineNetCents: 14520, taxCents: 2759, grossCents: 17279 },
      })
      .throwOnError();
    if (state === 'draft') return JSON.stringify({ id: invoiceId, heading: 'Rechnungsentwurf' });
    // The function issues only the number and day the action checked: the series' next, the Berlin day.
    const { data: series } = await admin
      .rpc('get_invoice_settings', { p_organization_id: orgId })
      .throwOnError();
    const expectedNumber =
      typeof series === 'object' && series !== null && 'nextInvoiceNumber' in series
        ? String(series.nextInvoiceNumber)
        : '';
    const { data: issued } = await admin
      .rpc('issue_invoice', {
        p_actor_id: actor,
        p_organization_id: orgId,
        p_invoice_id: invoiceId,
        p_expected_version: 2,
        p_attempt_key: randomUUID(),
        p_snapshot: SNAPSHOT,
        p_expected_number: expectedNumber,
        p_expected_issue_date: getBusinessTodayIso(),
      })
      .throwOnError();
    const number =
      typeof issued === 'object' && issued !== null && 'invoiceNumber' in issued
        ? String(issued.invoiceNumber)
        : '';
    if (state === 'filed') {
      const documentId = randomUUID();
      await admin
        .rpc('register_invoice_original', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_invoice_id: invoiceId,
          p_document_id: documentId,
          p_storage_path: `${orgId}/${documentId}/Rechnung.pdf`,
          p_file_name: `Rechnung ${number}.pdf`,
          p_size_bytes: 4096,
          p_content_hash: 'a'.repeat(64),
        })
        .throwOnError();
    }
    return JSON.stringify({ id: invoiceId, heading: `Rechnung ${number}` });
  });
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || !('id' in parsed) || !('heading' in parsed)) {
    throw new Error('invoice fixture read back no id');
  }
  return { id: String(parsed.id), heading: String(parsed.heading) };
}

const invoicePage =
  (state: 'draft' | 'pending' | 'filed') =>
  async (world: TestWorld): Promise<SurfaceDestination> => {
    const { id, heading } = await seedInvoice(world, state);
    return { route: `/rechnungen/${id}`, heading };
  };

type SetCapture = OpenSet['captures'][number];
const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
const page = { kind: 'page' } as const;

/**
 * werk-flow/werkflow-planning#457 of 2026-11-17: Einstellungen → Rechnungen
 * for Admin (editable) and Büro (read only); a draft with „Vorschau“ and
 * „Ausstellen“ and its confirmation; an issued invoice with its original
 * pending and filed. A field worker gets no route, row or action
 * (lib/invoices/issue-boundaries.test.ts). The refused check's list is
 * proven by the boundary test, which drives the real action.
 */
function captures(): SetCapture[] {
  return [
    { id: 'admin-einstellungen', role: 'admin', route: '/einstellungen/rechnungen', view: page, ...both },
    { id: 'buero-einstellungen', role: 'buero', route: '/einstellungen/rechnungen', view: page, ...both },
    {
      id: 'admin-entwurf',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: page,
      destination: invoicePage('draft'),
      ...both,
    },
    {
      id: 'admin-ausstellen',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: { kind: 'dialog', opener: 'commercial.invoice-issue' },
      destination: invoicePage('draft'),
      ...both,
    },
    {
      id: 'buero-beleg-ausstehend',
      role: 'buero',
      route: '/rechnungen/[invoiceId]',
      view: page,
      destination: invoicePage('pending'),
      ...both,
    },
    {
      id: 'admin-ausgestellt',
      role: 'admin',
      route: '/rechnungen/[invoiceId]',
      view: page,
      destination: invoicePage('filed'),
      ...both,
    },
  ];
}

acceptanceSet({ id: 'invoice-issue-2026-11-17', captures: captures(), standalone: [] });
