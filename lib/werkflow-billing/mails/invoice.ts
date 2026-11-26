import { formatEuro, renderMail, type RenderedMail } from '@/lib/werkflow-billing/mails/layout';
import { formatGermanDate } from '@/lib/utils';

// The mails around one WerkFlow invoice (werk-flow/werkflow-planning#492):
// the debit notice before a renewal, the invoice with its original, and the
// receipt. The debit notice and the invoice mail of a SEPA debit are WerkFlow's
// own pre-notification (register LQ-60): amount, debit date, last IBAN digits,
// mandate reference, Gläubiger-ID and contact. Dates are `YYYY-MM-DD`.

type Facts = (readonly [string, string])[];

export type SepaDebit = {
  kind: 'sepa_debit';
  debitDate: string;
  ibanLastFour: string | null;
  mandateReference: string | null;
  creditorId: string;
};

type CardPayment = { kind: 'card'; lastFour: string | null };

const account = (lastFour: string | null) =>
  lastFour ? `deinem Konto mit der Endung ${lastFour}` : 'deinem Konto';

function sepaFacts(debit: SepaDebit, label: string): Facts {
  return [
    [label, formatGermanDate(debit.debitDate)],
    ...(debit.ibanLastFour ? [['IBAN endet auf', debit.ibanLastFour] as const] : []),
    ...(debit.mandateReference ? [['Mandatsreferenz', debit.mandateReference] as const] : []),
    ['Gläubiger-ID', debit.creditorId],
  ];
}

const reply = (contact: string) => `Bei Fragen antworte einfach auf diese E-Mail oder schreib an ${contact}.`;

/** Before a renewal: the amount and date of the coming SEPA debit. */
export function renderDebitNoticeMail(mail: {
  amountCents: number;
  debit: SepaDebit;
  contact: string;
}): RenderedMail {
  const date = formatGermanDate(mail.debit.debitDate);
  return renderMail({
    subject: `Ankündigung: Lastschrift für WerkFlow am ${date}`,
    heading: 'Deine nächste Lastschrift',
    paragraphs: [
      'Hallo,',
      `am ${date} verlängert sich dein WerkFlow-Abo. Wir buchen dann ${formatEuro(mail.amountCents)} per SEPA-Lastschrift von ${account(mail.debit.ibanLastFour)} ab.`,
      'Die Rechnung bekommst du, sobald wir abbuchen. Du musst nichts tun.',
    ],
    facts: [['Betrag', formatEuro(mail.amountCents)], ...sepaFacts(mail.debit, 'Abbuchung am')],
    footnote: reply(mail.contact),
  });
}

export type InvoiceMail = {
  invoiceNumber: string;
  issueDate: string;
  grossCents: number;
  dueCents: number;
  payment: SepaDebit | CardPayment | null;
  contact: string;
};

function howItIsPaid(mail: InvoiceMail): string {
  const amount = formatEuro(mail.dueCents);
  if (mail.dueCents <= 0) return 'Die Rechnung ist bereits bezahlt. Du musst nichts tun.';
  if (mail.payment?.kind === 'sepa_debit') {
    return `Wir buchen ${amount} am ${formatGermanDate(mail.payment.debitDate)} per SEPA-Lastschrift von ${account(mail.payment.ibanLastFour)} ab. Du musst nichts tun.`;
  }
  if (mail.payment?.kind === 'card') {
    const card = mail.payment.lastFour
      ? `deine Karte mit der Endung ${mail.payment.lastFour}`
      : 'deine Karte';
    return `Wir belasten ${card} mit ${amount}. Du musst nichts tun.`;
  }
  return `Wir ziehen ${amount} mit deiner hinterlegten Zahlungsart ein. Du musst nichts tun.`;
}

/** The invoice, with its original attached by the caller. */
export function renderInvoiceMail(mail: InvoiceMail): RenderedMail {
  return renderMail({
    subject: `Deine WerkFlow-Rechnung ${mail.invoiceNumber}`,
    heading: 'Deine Rechnung ist da',
    paragraphs: [
      'Hallo,',
      `anbei deine WerkFlow-Rechnung ${mail.invoiceNumber} als PDF. Sie ist zugleich eine E-Rechnung (ZUGFeRD), du kannst sie so in deine Buchhaltung übernehmen.`,
      howItIsPaid(mail),
    ],
    facts: [
      ['Rechnung', mail.invoiceNumber],
      ['Rechnungsdatum', formatGermanDate(mail.issueDate)],
      ['Betrag', formatEuro(mail.grossCents)],
      ...(mail.dueCents > 0 && mail.payment?.kind === 'sepa_debit'
        ? sepaFacts(mail.payment, 'Abbuchung am')
        : []),
    ],
    footnote: reply(mail.contact),
  });
}

/** Once Stripe reports the invoice paid. */
export function renderReceiptMail(mail: {
  invoiceNumber: string;
  amountPaidCents: number;
  paidOn: string;
  method: { kind: 'sepa_debit' } | CardPayment | null;
  contact: string;
}): RenderedMail {
  const method =
    mail.method?.kind === 'sepa_debit'
      ? 'SEPA-Lastschrift'
      : mail.method?.kind === 'card'
        ? `Karte${mail.method.lastFour ? ` mit der Endung ${mail.method.lastFour}` : ''}`
        : null;
  return renderMail({
    subject: `Zahlung erhalten: WerkFlow-Rechnung ${mail.invoiceNumber}`,
    heading: 'Danke, deine Zahlung ist da',
    paragraphs: [
      'Hallo,',
      `wir haben ${formatEuro(mail.amountPaidCents)} für deine WerkFlow-Rechnung ${mail.invoiceNumber} erhalten. Du musst nichts weiter tun.`,
    ],
    facts: [
      ['Rechnung', mail.invoiceNumber],
      ['Betrag', formatEuro(mail.amountPaidCents)],
      ['Bezahlt am', formatGermanDate(mail.paidOn)],
      ...(method ? [['Zahlungsart', method] as const] : []),
    ],
    footnote: reply(mail.contact),
  });
}
