import 'server-only';

import { loggedRead } from '@/lib/data/read-request-cache';
import { readDeliverySender } from '@/lib/delivery/document-delivery';
import { recipientSchema, type DeliveryMailDefaults } from '@/lib/delivery/delivery-types';
import { formatEuroCents } from '@/lib/document-rendering/format';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { formatGermanDate } from '@/lib/utils';
import type { InvoiceDetail } from './types';

// What „Per E-Mail senden“ proposes for an issued invoice: the
// Rechnungsempfänger's email, else that customer's active main contact's;
// a subject and a text naming number, date and amount, signed with the
// sender's name. The office changes each before it sends.

/** The Rechnungsempfänger's address for invoices; empty when the customer records none. */
async function readRecipientEmail(organizationId: string, clientId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const [client, contact] = await Promise.all([
    loggedRead(
      'readRecipientEmail: client read failed',
      admin
        .from('clients')
        .select('email')
        .eq('organization_id', organizationId)
        .eq('id', clientId)
        .maybeSingle(),
    ),
    loggedRead(
      'readRecipientEmail: contact read failed',
      admin
        .from('client_contacts')
        .select('email')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('is_active', true)
        .eq('is_primary', true)
        .is('site_id', null)
        .not('email', 'is', null)
        .order('created_at')
        .limit(1)
        .maybeSingle(),
    ),
  ]);
  if (client.error || contact.error) throw new Error('recipient_email_read_failed');
  for (const candidate of [client.data?.email, contact.data?.email]) {
    const parsed = recipientSchema.safeParse(candidate?.trim());
    if (parsed.success) return parsed.data;
  }
  return '';
}

export async function readInvoiceMailDefaults(
  caller: Pick<ActionContext, 'userId' | 'orgId' | 'isManagerOrAbove'>,
  invoice: Pick<InvoiceDetail, 'invoiceNumber' | 'issueDate' | 'grossCents' | 'recipient'>,
): Promise<DeliveryMailDefaults> {
  const [recipient, sender] = await Promise.all([
    readRecipientEmail(caller.orgId, invoice.recipient.id),
    readDeliverySender(caller),
  ]);
  if (!sender) throw new Error('delivery_sender_read_failed');
  const number = invoice.invoiceNumber ?? '';
  const dated = invoice.issueDate ? ` vom ${formatGermanDate(invoice.issueDate)}` : '';
  return {
    recipient,
    subject: `Rechnung ${number} – ${sender.name}`,
    text: [
      'Guten Tag,',
      `anbei die Rechnung ${number}${dated} über ${formatEuroCents(invoice.grossCents)}. Vielen Dank für den Auftrag.`,
      `Mit freundlichen Grüßen\n${sender.name}`,
    ].join('\n\n'),
  };
}
