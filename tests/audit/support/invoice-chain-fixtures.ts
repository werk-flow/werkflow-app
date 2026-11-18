import { randomUUID } from 'node:crypto';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '../../../lib/company-profile/profile';
import { getBusinessTodayIso } from '../../../lib/date-time/berlin';
import { rpcArgs } from '../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../golden/support/db/shared';
import type { TestWorld } from '../../golden/support/world';

// Issued invoices for the audit world, written through the office's database
// functions: create, save, issue, register a stand-in original (which files
// it), and for a chain cancel with a correction and register the
// Stornorechnung's stand-in original, as the actions do after rendering.

const CUSTOMER = 'Hausverwaltung Lindenhof GmbH';

const SNAPSHOT = {
  organizationName: 'Haustechnik Sonnenberg',
  profile: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
  files: { logo: null, stationery_first: null, stationery_following: null },
  buyer: {
    name: CUSTOMER,
    address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
  },
};

export type InvoiceChainFixture = {
  originalId: string;
  originalNumber: string;
  /** Null for an invoice that stays issued. */
  stornoId: string | null;
  stornoNumber: string | null;
  correctionId: string | null;
};

function stringField(value: unknown, key: string): string {
  const field: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, key) : null;
  if (typeof field !== 'string') throw new Error(`invoice fixture answered no ${key}`);
  return field;
}

async function fileStandIn(world: TestWorld, invoiceId: string, number: string): Promise<void> {
  const documentId = randomUUID();
  await createAdminClient()
    .rpc('register_invoice_original', {
      p_actor_id: world.users.buero.id,
      p_organization_id: world.orgId,
      p_invoice_id: invoiceId,
      p_document_id: documentId,
      p_storage_path: `${world.orgId}/${documentId}/Rechnung.pdf`,
      p_file_name: `Rechnung ${number}.pdf`,
      p_size_bytes: 4096,
      p_content_hash: 'a'.repeat(64),
    })
    .throwOnError();
}

/** An issued, filed invoice of its own customer; `cancelled` also cancels and corrects it. */
async function seed(world: TestWorld, state: 'issued' | 'cancelled'): Promise<InvoiceChainFixture> {
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
      // 1,5 h × 72,00 € at 19 %.
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
      ],
      p_totals: { lineNetCents: 10800, taxCents: 2052, grossCents: 12852 },
    })
    .throwOnError();
  const { data: issued } = await admin
    .rpc('issue_invoice', {
      p_actor_id: actor,
      p_organization_id: orgId,
      p_invoice_id: invoiceId,
      p_expected_version: 2,
      p_attempt_key: randomUUID(),
      p_snapshot: SNAPSHOT,
    })
    .throwOnError();
  const originalNumber = stringField(issued, 'invoiceNumber');
  await fileStandIn(world, invoiceId, originalNumber);
  if (state === 'issued') {
    return { originalId: invoiceId, originalNumber, stornoId: null, stornoNumber: null, correctionId: null };
  }
  // The Stornorechnung takes the series' next number on the Berlin day, as the action checks it.
  const { data: series } = await admin
    .rpc('get_invoice_settings', { p_organization_id: orgId })
    .throwOnError();
  const { data: cancelled } = await admin
    .rpc('cancel_invoice', {
      p_actor_id: actor,
      p_organization_id: orgId,
      p_invoice_id: invoiceId,
      p_attempt_key: randomUUID(),
      p_reason: 'Falscher Rechnungsempfänger',
      p_correct: true,
      p_expected_number: stringField(series, 'nextInvoiceNumber'),
      p_expected_issue_date: getBusinessTodayIso(),
    })
    .throwOnError();
  const stornoId = stringField(cancelled, 'stornoId');
  const stornoNumber = stringField(cancelled, 'stornoNumber');
  await fileStandIn(world, stornoId, stornoNumber);
  return {
    originalId: invoiceId,
    originalNumber,
    stornoId,
    stornoNumber,
    correctionId: stringField(cancelled, 'correctionId'),
  };
}

/**
 * The world's invoice of `state` as `surfaceFixture`'s arguments: seeded once
 * per world, its value the JSON `parseInvoiceChain` reads.
 */
export function invoiceChainSeed(
  world: TestWorld,
  state: 'issued' | 'cancelled',
): { name: `commercial.${string}`; create: () => Promise<string> } {
  return {
    name: `commercial.invoice-chain-${state}`,
    create: async () => JSON.stringify(await seed(world, state)),
  };
}

/** The ids and numbers a seeded chain's fixture value holds. */
export function parseInvoiceChain(value: string): InvoiceChainFixture {
  const parsed: unknown = JSON.parse(value);
  const nullable = (key: string) =>
    Reflect.get(Object(parsed), key) === null ? null : stringField(parsed, key);
  return {
    originalId: stringField(parsed, 'originalId'),
    originalNumber: stringField(parsed, 'originalNumber'),
    stornoId: nullable('stornoId'),
    stornoNumber: nullable('stornoNumber'),
    correctionId: nullable('correctionId'),
  };
}
