import { randomUUID } from 'node:crypto';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '../../../lib/company-profile/profile';
import { getBusinessTodayIso } from '../../../lib/date-time/berlin';
import { rpcArgs } from '../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../golden/support/db/shared';
import type { TestWorld } from '../../golden/support/world';

// Issued invoices with a filed stand-in original for the audit world, written
// through the office's database functions as the issue action writes them;
// `delivered` also sends it three times as the delivery module records it:
// an email that went out, one the provider refused, and one by post. The
// `cancelled` states then cancel it as „Stornieren“ does.

const CUSTOMER = 'Hausverwaltung Lindenhof GmbH';

function field(value: unknown, key: string): string {
  const found: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, key) : null;
  if (typeof found !== 'string') throw new Error(`delivery fixture answered no ${key}`);
  return found;
}

async function issueFiled(
  world: TestWorld,
  name: string,
): Promise<{ id: string; number: string; documentId: string }> {
  const admin = createAdminClient();
  const actor = world.users.buero.id;
  const orgId = world.orgId;
  const clientId = randomUUID();
  await admin
    .from('clients')
    .insert({
      id: clientId,
      organization_id: orgId,
      name: `${CUSTOMER} ${name} ${world.runId}`,
      address: 'Hofweg 1, 10117 Berlin',
      email: 'buchhaltung@lindenhof.example',
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
        orderReference: '',
        buyerReference: '',
        openingText: '',
        closingText: '',
      },
      p_lines: [
        {
          name: 'Wartung Gastherme',
          description: '',
          quantity: '1',
          unit: 'piece',
          unitPriceCents: 18900,
          priceQuantity: 1,
          taxCategory: 'S',
          taxRateBasisPoints: 1900,
          netCents: 18900,
        },
      ],
      p_totals: { lineNetCents: 18900, taxCents: 3591, grossCents: 22491 },
    })
    .throwOnError();
  const { data: series } = await admin
    .rpc('get_invoice_settings', { p_organization_id: orgId })
    .throwOnError();
  const documentId = randomUUID();
  const number = field(series, 'nextInvoiceNumber');
  const { data: issued } = await admin
    .rpc('issue_invoice', {
      p_actor_id: actor,
      p_organization_id: orgId,
      p_invoice_id: invoiceId,
      p_expected_version: 2,
      p_attempt_key: randomUUID(),
      p_snapshot: {
        organizationName: 'Haustechnik Sonnenberg',
        profile: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
        files: { logo: null, stationery_first: null, stationery_following: null },
        buyer: {
          name: CUSTOMER,
          address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
        },
      },
      p_expected_number: number,
      p_expected_issue_date: getBusinessTodayIso(),
      p_original_document_id: documentId,
      p_original_storage_path: `${orgId}/${documentId}/Rechnung ${number}.pdf`,
      p_original_file_name: `Rechnung ${number}.pdf`,
      p_original_size_bytes: 4096,
      p_original_content_hash: 'a'.repeat(64),
    })
    .throwOnError();
  return { id: field({ id: invoiceId }, 'id'), number: field(issued, 'invoiceNumber'), documentId };
}

/** An email delivery of the invoice, settled as the transport answered. */
async function emailed(
  world: TestWorld,
  invoice: { id: string; number: string; documentId: string },
  recipient: string,
  answer: { messageId: string } | { failureCode: string },
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .rpc(
      'request_document_delivery',
      rpcArgs('request_document_delivery', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_attempt_key: randomUUID(),
        p_subject_kind: 'invoice',
        p_subject_id: invoice.id,
        p_document_id: invoice.documentId,
        p_recipient_email: recipient,
        p_email_subject: `Rechnung ${invoice.number} – Haustechnik Sonnenberg GmbH`,
        p_message_text: `Guten Tag,\n\nanbei die Rechnung ${invoice.number}.`,
        p_sender_name: 'Haustechnik Sonnenberg GmbH',
        p_from_header: '"Haustechnik Sonnenberg GmbH" <noreply@werkflow.test>',
        p_reply_to: null,
      }),
    )
    .throwOnError();
  await admin
    .rpc(
      'settle_document_delivery',
      rpcArgs('settle_document_delivery', {
        p_organization_id: world.orgId,
        p_delivery_id: field(data, 'deliveryId'),
        p_attempt: 1,
        p_outcome: 'messageId' in answer ? 'sent' : 'failed',
        p_provider_message_id: 'messageId' in answer ? answer.messageId : null,
        p_failure_code: 'failureCode' in answer ? answer.failureCode : null,
      }),
    )
    .throwOnError();
}

/** Cancels the invoice without a correction; its Stornorechnung stays without an original. */
async function cancel(world: TestWorld, invoiceId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: series } = await admin
    .rpc('get_invoice_settings', { p_organization_id: world.orgId })
    .throwOnError();
  await admin
    .rpc('cancel_invoice', {
      p_actor_id: world.users.buero.id,
      p_organization_id: world.orgId,
      p_invoice_id: invoiceId,
      p_attempt_key: randomUUID(),
      p_reason: 'Falscher Rechnungsempfänger',
      p_correct: false,
      p_expected_number: field(series, 'nextInvoiceNumber'),
      p_expected_issue_date: getBusinessTodayIso(),
    })
    .throwOnError();
}

type DeliverySeedState = 'fresh' | 'delivered' | 'cancelled' | 'cancelled-delivered';

/**
 * The seed of an issued invoice with its filed original for `surfaceFixture`:
 * `fresh` was never sent, `delivered` went out by email, failed once and went
 * by post; the `cancelled` states are the same invoice cancelled afterwards.
 * `parseDeliverySeed` reads back what `create` stored.
 */
export function invoiceDeliverySeed(
  world: TestWorld,
  state: DeliverySeedState,
): { name: `commercial.invoice-delivery-${DeliverySeedState}`; create: () => Promise<string> } {
  return {
    name: `commercial.invoice-delivery-${state}`,
    create: async () => {
      const invoice = await issueFiled(world, state);
      if (state === 'delivered' || state === 'cancelled-delivered') {
        await emailed(world, invoice, 'buchhaltung@lindenhof.example', { messageId: randomUUID() });
        await emailed(world, invoice, 'verwaltung@lindenhof.example', { failureCode: 'email_provider_503' });
        await createAdminClient()
          .rpc('record_manual_delivery', {
            p_actor_id: world.users.admin.id,
            p_organization_id: world.orgId,
            p_attempt_key: randomUUID(),
            p_subject_kind: 'invoice',
            p_subject_id: invoice.id,
            p_document_id: invoice.documentId,
            p_note: 'per Post an die Hausverwaltung',
          })
          .throwOnError();
      }
      if (state === 'cancelled' || state === 'cancelled-delivered') await cancel(world, invoice.id);
      return JSON.stringify({ id: invoice.id, heading: `Rechnung ${invoice.number}` });
    },
  };
}

/** The invoice id and page heading a seed stored. */
export function parseDeliverySeed(value: string): { id: string; heading: string } {
  const parsed: unknown = JSON.parse(value);
  return { id: field(parsed, 'id'), heading: field(parsed, 'heading') };
}
