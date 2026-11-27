import 'server-only';

import { readDeliverySender } from '@/lib/delivery/document-delivery';
import type { DeliveryMailDefaults } from '@/lib/delivery/delivery-types';
import { readRecipientEmail } from '@/lib/delivery/recipient-email';
import { formatEuroCents } from '@/lib/document-rendering/format';
import type { ActionContext } from '@/lib/org/action-context';
import { formatGermanDate } from '@/lib/utils';
import type { InvoiceDetail } from './types';

// What „Per E-Mail senden“ proposes for an issued invoice: the
// Rechnungsempfänger's email, else that customer's active main contact's;
// a subject and a text naming number, date and amount, signed with the
// sender's name. The office changes each before it sends.

export async function readInvoiceMailDefaults(
  caller: Pick<ActionContext, 'userId' | 'orgId' | 'isManagerOrAbove'>,
  invoice: Pick<InvoiceDetail, 'invoiceNumber' | 'issueDate' | 'grossCents' | 'recipient'>,
): Promise<DeliveryMailDefaults> {
  const [recipient, sender] = await Promise.all([
    readRecipientEmail(caller.orgId, { clientId: invoice.recipient.id }),
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
