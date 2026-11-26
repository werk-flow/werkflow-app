import { randomUUID } from 'node:crypto';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '../../../../lib/company-profile/profile';
import { getBusinessTodayIso } from '../../../../lib/date-time/berlin';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from './shared';

// Issued invoices written through the office's database functions: create,
// save, issue, register a stand-in original (which files it), and for a
// chain cancel with a correction and register the Stornorechnung's stand-in
// original, as the actions do after rendering.

const SNAPSHOT = {
  organizationName: 'Haustechnik Sonnenberg',
  // A seller the EN 16931 rules accept, so a Stornorechnung of it passes the check.
  profile: {
    ...EMPTY_COMPANY_PROFILE_DETAILS,
    companyName: 'Haustechnik Sonnenberg GmbH',
    street: 'Sonnenweg 1',
    postalCode: '01234',
    city: 'Sonnenstadt',
    vatId: 'DE123456789',
    iban: 'DE00 1111 1111 1111 1111 11',
  },
  files: { logo: null, stationery_first: null, stationery_following: null },
  buyer: {
    name: 'Hausverwaltung Lindenhof GmbH',
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

type InvoiceSeedScope = { orgId: string; actorId: string };

/** A string field of a function's JSON answer or of a fixture value. */
export function invoiceFixtureField(value: unknown, key: string): string {
  const field: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, key) : null;
  if (typeof field !== 'string') throw new Error(`invoice fixture answered no ${key}`);
  return field;
}

async function fileStandIn(scope: InvoiceSeedScope, invoiceId: string, number: string): Promise<void> {
  const documentId = randomUUID();
  await createAdminClient()
    .rpc('register_invoice_original', {
      p_actor_id: scope.actorId,
      p_organization_id: scope.orgId,
      p_invoice_id: invoiceId,
      p_document_id: documentId,
      p_storage_path: `${scope.orgId}/${documentId}/Rechnung.pdf`,
      p_file_name: `Rechnung ${number}.pdf`,
      p_size_bytes: 4096,
      p_content_hash: 'a'.repeat(64),
    })
    .throwOnError();
}

/**
 * An issued, filed invoice of its own customer `customerName`; `cancelled`
 * also cancels and corrects it.
 */
export async function seedInvoiceChain(
  scope: InvoiceSeedScope & { customerName: string; state: 'issued' | 'cancelled' },
): Promise<InvoiceChainFixture> {
  const admin = createAdminClient();
  const { orgId, actorId: actor } = scope;
  const clientId = randomUUID();
  await admin
    .from('clients')
    .insert({
      id: clientId,
      organization_id: orgId,
      name: scope.customerName,
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
  // Each function issues only the number and day the action checked: the series' next, the Berlin day.
  const nextNumber = async () => {
    const { data: series } = await admin
      .rpc('get_invoice_settings', { p_organization_id: orgId })
      .throwOnError();
    return invoiceFixtureField(series, 'nextInvoiceNumber');
  };
  const { data: issued } = await admin
    .rpc('issue_invoice', {
      p_actor_id: actor,
      p_organization_id: orgId,
      p_invoice_id: invoiceId,
      p_expected_version: 2,
      p_attempt_key: randomUUID(),
      p_snapshot: SNAPSHOT,
      p_expected_number: await nextNumber(),
      p_expected_issue_date: getBusinessTodayIso(),
    })
    .throwOnError();
  const originalNumber = invoiceFixtureField(issued, 'invoiceNumber');
  await fileStandIn(scope, invoiceId, originalNumber);
  if (scope.state === 'issued') {
    return { originalId: invoiceId, originalNumber, stornoId: null, stornoNumber: null, correctionId: null };
  }
  const { data: cancelled } = await admin
    .rpc('cancel_invoice', {
      p_actor_id: actor,
      p_organization_id: orgId,
      p_invoice_id: invoiceId,
      p_attempt_key: randomUUID(),
      p_reason: 'Falscher Rechnungsempfänger',
      p_correct: true,
      p_expected_number: await nextNumber(),
      p_expected_issue_date: getBusinessTodayIso(),
    })
    .throwOnError();
  const stornoId = invoiceFixtureField(cancelled, 'stornoId');
  const stornoNumber = invoiceFixtureField(cancelled, 'stornoNumber');
  await fileStandIn(scope, stornoId, stornoNumber);
  return {
    originalId: invoiceId,
    originalNumber,
    stornoId,
    stornoNumber,
    correctionId: invoiceFixtureField(cancelled, 'correctionId'),
  };
}

/**
 * What a cancel stored: the original's status, and the Stornorechnung and
 * correction draft that link to it (null where none does).
 */
export async function readStoredInvoiceChain(orgId: string, originalId: string) {
  const admin = createAdminClient();
  const { data: original } = await admin
    .from('invoices')
    .select('status')
    .eq('organization_id', orgId)
    .eq('id', originalId)
    .single()
    .throwOnError();
  const linked = (column: 'cancels_invoice_id' | 'corrects_invoice_id') =>
    admin
      .from('invoices')
      .select('id, status')
      .eq('organization_id', orgId)
      .eq(column, originalId)
      .maybeSingle()
      .throwOnError();
  const [{ data: storno }, { data: correction }] = await Promise.all([
    linked('cancels_invoice_id'),
    linked('corrects_invoice_id'),
  ]);
  return { status: original.status, storno, correction };
}
