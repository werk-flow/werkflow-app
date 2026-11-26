import { formatEuro, renderMail, type RenderedMail } from '@/lib/werkflow-billing/mails/layout';

// The mail to a customer's billing contact when WerkFlow refunds an invoice
// (werk-flow/werkflow-planning#497). The Stornorechnung cancels the whole
// document; after a partial refund a new, paid invoice holds what stays. Both
// PDFs travel as attachments, so the mail names numbers and amounts only.

export type RefundMail = {
  stornoNumber: string;
  /** The document the Storno cancels: the original or an earlier replacement. */
  cancelledNumber: string;
  refundedCents: number;
  /** The paid invoice for what stays after a partial refund; null after a full one. */
  replacement: { number: string; grossCents: number } | null;
};

export function renderRefundMail(mail: RefundMail): RenderedMail {
  const { replacement } = mail;
  return renderMail({
    subject: `Deine Stornorechnung ${mail.stornoNumber} von WerkFlow`,
    heading: 'Wir haben dir Geld erstattet',
    paragraphs: [
      'Hallo,',
      `wir haben dir ${formatEuro(mail.refundedCents)} für deine WerkFlow-Rechnung ${mail.cancelledNumber} erstattet. Im Anhang findest du die Stornorechnung ${mail.stornoNumber}, die diese Rechnung aufhebt.`,
      replacement
        ? `Für den Betrag, der bleibt, findest du im Anhang die neue Rechnung ${replacement.number} über ${formatEuro(replacement.grossCents)}. Sie ist schon bezahlt, du musst nichts tun.`
        : 'Du musst nichts tun.',
      replacement
        ? 'Bitte nimm beide Belege in deine Buchhaltung auf.'
        : 'Bitte nimm die Stornorechnung in deine Buchhaltung auf.',
    ],
    facts: [
      ['Stornorechnung', mail.stornoNumber],
      ['Storniert', mail.cancelledNumber],
      ['Erstattet', formatEuro(mail.refundedCents)],
      ...(replacement ? [['Neue Rechnung', replacement.number] as const] : []),
    ],
    footnote: 'Bei Fragen antworte einfach auf diese E-Mail.',
  });
}
