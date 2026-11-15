import { describe, expect, test } from 'bun:test';

import { renderAlarmMail, type BillingAlarmKind } from './alarm';
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
])('the %s alarm names its facts and says it is internal', (kind) => {
  const mail = renderAlarmMail(kind, [['Stripe-Objekt', 'in_test_0001']]);
  expect(mail.subject).toStartWith('WerkFlow-Alarm: ');
  expect(mail.text).toContain('Stripe-Objekt: in_test_0001');
  expect(mail.text).toContain('nicht an Kunden');
});

test('amounts are German euros from integer cents', () => {
  // Intl puts a no-break space before the sign, so the amount never wraps.
  expect(formatEuro(4900)).toBe('49,00\u00a0€');
  expect(formatEuro(123456)).toBe('1.234,56\u00a0€');
});
