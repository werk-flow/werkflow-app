import { describe, expect, test } from 'bun:test';

import { renderAlarmMail, type BillingAlarmKind } from './alarm';
import { renderDebitNoticeMail, renderInvoiceMail, renderReceiptMail, type SepaDebit } from './invoice';
import { formatEuro } from './layout';
import { renderMandateInactiveMail } from './mandate';
import { renderCardProblemMail, renderDebitFailedMail } from './payment-failed';

// Every billing mail renders with made-up data in German with „du“, as HTML
// and plain text, and escapes what Stripe or a customer named. Tier 2.

const invoice = {
  customerName: 'Haustechnik Sonnenberg GmbH',
  invoiceNumber: 'SK5GYCE1-0001',
  amountRemainingCents: 4900,
  payUrl: 'https://invoice.stripe.com/i/acct_test/in_test_0001',
};

describe('customer mails', () => {
  test('a failed direct debit names the invoice, the amount and the way to pay', () => {
    const mail = renderDebitFailedMail(invoice);
    expect(mail.subject).toBe('Die Lastschrift für WerkFlow hat nicht geklappt');
    for (const part of [
      'SK5GYCE1-0001',
      '49,00\u00a0€',
      'Haustechnik Sonnenberg GmbH',
      'ganz normal weiter',
    ]) {
      expect(mail.html).toContain(part);
      expect(mail.text).toContain(part);
    }
    expect(mail.html).toContain(`href="${invoice.payUrl}"`);
    expect(mail.text).toContain(`Rechnung bezahlen: ${invoice.payUrl}`);
    expect(mail.html).toStartWith('<!DOCTYPE html>\n<html lang="de">');
  });

  test('without a payment page the mail offers no button', () => {
    const mail = renderDebitFailedMail({ ...invoice, payUrl: null, invoiceNumber: null });
    expect(mail.html).not.toContain('<a ');
    expect(mail.text).toContain('deine WerkFlow-Rechnung nicht');
  });

  test('a declined card asks for a valid card', () => {
    const mail = renderCardProblemMail(invoice);
    expect(mail.subject).toBe('Deine Karte wurde für WerkFlow abgelehnt');
    expect(mail.text).toContain('abgelaufen oder gesperrt');
  });

  test('an inactive mandate names the account ending and asks for a new mandate', () => {
    const mail = renderMandateInactiveMail({ customerName: invoice.customerName, ibanLastFour: '3000' });
    expect(mail.subject).toBe('Dein Lastschriftmandat für WerkFlow gilt nicht mehr');
    expect(mail.text).toContain('deinem Konto mit der Endung 3000');
    expect(mail.text).toContain('Antworte einfach auf diese E-Mail');
  });

  test('a name from Stripe is escaped', () => {
    const mail = renderDebitFailedMail({ ...invoice, customerName: '<script>alert(1)</script> & Söhne' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Söhne');
  });
});

test.each<BillingAlarmKind>([
  'debit_failed',
  'debit_reversed',
  'mandate_inactive',
  'mail_failed',
  'invoice_check_failed',
  'invoice_undelivered',
  'debit_notice_late',
  'mail_undelivered',
  'signals_quiet',
  'reconciliation_missed',
])('the %s alarm names its facts and says it is internal', (kind) => {
  const mail = renderAlarmMail(kind, [['Stripe-Objekt', 'in_test_0001']]);
  expect(mail.subject).toStartWith('WerkFlow-Alarm: ');
  expect(mail.text).toContain('Stripe-Objekt: in_test_0001');
  expect(mail.text).toContain('nicht an Kunden');
});

describe('the mails around an invoice (werk-flow/werkflow-planning#492)', () => {
  const debit: SepaDebit = {
    kind: 'sepa_debit',
    debitDate: '2026-12-15',
    ibanLastFour: '3000',
    mandateReference: 'MUSTERMANDAT0001',
    creditorId: 'DE98ZZZ09999999999',
  };
  const contact = 'hallo@musterfirma.example';
  const announcement = [
    '49,00\u00a0€',
    '15.12.2026',
    '3000',
    'MUSTERMANDAT0001',
    'DE98ZZZ09999999999',
    contact,
  ];

  test('the debit notice is a SEPA pre-notification: amount, date, IBAN ending, mandate, creditor ID and contact', () => {
    const mail = renderDebitNoticeMail({ amountCents: 4900, debit, contact });
    expect(mail.subject).toBe('Ankündigung: Lastschrift für WerkFlow am 15.12.2026');
    for (const part of announcement) {
      expect(mail.html).toContain(part);
      expect(mail.text).toContain(part);
    }
  });

  test('the invoice mail of a SEPA debit announces it the same way', () => {
    const mail = renderInvoiceMail({
      invoiceNumber: 'MUSTER-0001',
      issueDate: '2026-12-15',
      grossCents: 4900,
      dueCents: 4900,
      payment: debit,
      contact,
    });
    expect(mail.subject).toBe('Deine WerkFlow-Rechnung MUSTER-0001');
    for (const part of [...announcement, 'MUSTER-0001', 'E-Rechnung']) expect(mail.text).toContain(part);
  });

  test('a card invoice names the card, a paid one says nothing is open, and neither names a debit', () => {
    const card = renderInvoiceMail({
      invoiceNumber: 'MUSTER-0002',
      issueDate: '2026-12-15',
      grossCents: 4900,
      dueCents: 4900,
      payment: { kind: 'card', lastFour: '4242' },
      contact,
    });
    expect(card.text).toContain('deine Karte mit der Endung 4242 mit 49,00');
    const paid = renderInvoiceMail({
      invoiceNumber: 'MUSTER-0003',
      issueDate: '2026-12-15',
      grossCents: 4900,
      dueCents: 0,
      payment: debit,
      contact,
    });
    expect(paid.text).toContain('bereits bezahlt');
    for (const mail of [card, paid]) expect(mail.text).not.toContain('Gläubiger-ID');
  });

  test('the receipt names the invoice, the amount, the day and the way it was paid', () => {
    const mail = renderReceiptMail({
      invoiceNumber: 'MUSTER-0001',
      amountPaidCents: 4900,
      paidOn: '2026-12-23',
      method: { kind: 'sepa_debit' },
      contact,
    });
    expect(mail.subject).toBe('Zahlung erhalten: WerkFlow-Rechnung MUSTER-0001');
    for (const part of ['49,00\u00a0€', '23.12.2026', 'SEPA-Lastschrift', 'Danke'])
      expect(mail.text).toContain(part);
  });
});

test('amounts are German euros from integer cents', () => {
  // Intl puts a no-break space before the sign, so the amount never wraps.
  expect(formatEuro(4900)).toBe('49,00\u00a0€');
  expect(formatEuro(123456)).toBe('1.234,56\u00a0€');
});
