import { formatEuro, renderMail, type RenderedMail } from '@/lib/werkflow-billing/mails/layout';

// The mail to a customer's billing contact when Stripe could not collect a
// WerkFlow invoice (werk-flow/werkflow-planning#251). A failed debit changes no
// access in stage A (epic decision 8), so the mail says WerkFlow keeps running.

export type PaymentFailedMail = {
  customerName: string | null;
  invoiceNumber: string | null;
  amountRemainingCents: number;
  /** Stripe's page where the invoice can be paid another way. */
  payUrl: string | null;
};

const REPLY = 'Bei Fragen antworte einfach auf diese E-Mail.';

function invoiceFacts(mail: PaymentFailedMail): (readonly [string, string])[] {
  return [
    ...(mail.customerName ? [['Kunde', mail.customerName] as const] : []),
    ...(mail.invoiceNumber ? [['Rechnung', mail.invoiceNumber] as const] : []),
    ['Offener Betrag', formatEuro(mail.amountRemainingCents)],
  ];
}

function invoiceName(mail: PaymentFailedMail): string {
  return mail.invoiceNumber ? `deine WerkFlow-Rechnung ${mail.invoiceNumber}` : 'deine WerkFlow-Rechnung';
}

/** A SEPA direct debit came back or could not be collected. */
export function renderDebitFailedMail(mail: PaymentFailedMail): RenderedMail {
  return renderMail({
    subject: 'Die Lastschrift für WerkFlow hat nicht geklappt',
    heading: 'Die Lastschrift hat nicht geklappt',
    paragraphs: [
      'Hallo,',
      `wir konnten den Betrag für ${invoiceName(mail)} nicht von deinem Konto abbuchen. WerkFlow läuft für dich und dein Team ganz normal weiter.`,
      mail.payUrl
        ? 'Bitte prüfe, ob dein Konto gedeckt ist und die Kontodaten stimmen. Du kannst die Rechnung auch direkt über den Button bezahlen.'
        : 'Bitte prüfe, ob dein Konto gedeckt ist und die Kontodaten stimmen.',
    ],
    facts: invoiceFacts(mail),
    ...(mail.payUrl ? { action: { label: 'Rechnung bezahlen', url: mail.payUrl } } : {}),
    footnote: REPLY,
  });
}

/** A card payment was declined, for example because the card expired. */
export function renderCardProblemMail(mail: PaymentFailedMail): RenderedMail {
  return renderMail({
    subject: 'Deine Karte wurde für WerkFlow abgelehnt',
    heading: 'Die Kartenzahlung hat nicht geklappt',
    paragraphs: [
      'Hallo,',
      `wir konnten ${invoiceName(mail)} nicht von deiner Karte abbuchen. Vielleicht ist sie abgelaufen oder gesperrt. WerkFlow läuft für dich und dein Team ganz normal weiter.`,
      mail.payUrl
        ? 'Bitte bezahle die Rechnung über den Button mit einer gültigen Karte.'
        : 'Bitte gib uns eine gültige Karte, damit wir die Rechnung einziehen können.',
    ],
    facts: invoiceFacts(mail),
    ...(mail.payUrl ? { action: { label: 'Rechnung bezahlen', url: mail.payUrl } } : {}),
    footnote: REPLY,
  });
}
