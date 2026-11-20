import { renderMail, type RenderedMail } from '@/lib/werkflow-billing/mails/layout';

// The mail to a customer's billing contact when its SEPA mandate became
// inactive, for example because the bank revoked it
// (werk-flow/werkflow-planning#251). Access stays (epic decision 8).

export type MandateInactiveMail = {
  customerName: string | null;
  /** The last four digits of the IBAN, as Stripe keeps them. */
  ibanLastFour: string | null;
};

export function renderMandateInactiveMail(mail: MandateInactiveMail): RenderedMail {
  const account = mail.ibanLastFour ? `deinem Konto mit der Endung ${mail.ibanLastFour}` : 'deinem Konto';
  return renderMail({
    subject: 'Dein Lastschriftmandat für WerkFlow gilt nicht mehr',
    heading: 'Dein Lastschriftmandat gilt nicht mehr',
    paragraphs: [
      'Hallo,',
      `deine Bank hat uns mitgeteilt, dass wir von ${account} nicht mehr abbuchen dürfen. WerkFlow läuft für dich und dein Team ganz normal weiter.`,
      'Damit wir die nächste Rechnung einziehen können, brauchen wir ein neues Lastschriftmandat oder eine andere Zahlungsart. Antworte einfach auf diese E-Mail, dann klären wir das zusammen.',
    ],
    ...(mail.customerName ? { facts: [['Kunde', mail.customerName] as const] } : {}),
  });
}
