import { expect, test } from 'bun:test';
import { deliveryHtml, senderHeader } from './mail-content';

// The mail a delivery sends carries only escaped text, and its From header
// names the company over WerkFlow's sending address, never a second address
// or a header line the company name smuggles in. Tier 2.

test('the text becomes escaped paragraphs and line breaks', () => {
  expect(deliveryHtml('Guten Tag,\n\nanbei <b>die</b> Rechnung & mehr.\nZeile zwei\n\n')).toBe(
    '<p>Guten Tag,</p>\n<p>anbei &lt;b&gt;die&lt;/b&gt; Rechnung &amp; mehr.<br>Zeile zwei</p>',
  );
});

test.each([
  [
    'WerkFlow <rechnung@werkflow.example>',
    'Haustechnik Sonnenberg GmbH',
    '"Haustechnik Sonnenberg GmbH" <rechnung@werkflow.example>',
  ],
  [
    'rechnung@werkflow.example',
    'Haustechnik Sonnenberg GmbH',
    '"Haustechnik Sonnenberg GmbH" <rechnung@werkflow.example>',
  ],
  [
    'WerkFlow <rechnung@werkflow.example>',
    'Böse "GmbH"\r\nBcc: x@example.com',
    '"Böse GmbH Bcc: x@example.com" <rechnung@werkflow.example>',
  ],
  ['WerkFlow <rechnung@werkflow.example>', '  ', 'rechnung@werkflow.example'],
])('FROM_EMAIL %j with company %j sends from %j', (configured, company, expected) => {
  expect(senderHeader(company, { FROM_EMAIL: configured })).toBe(expected);
});

test('without a sending address the transport decides', () => {
  expect(senderHeader('Haustechnik Sonnenberg GmbH', {})).toBeUndefined();
  expect(senderHeader('Haustechnik Sonnenberg GmbH', { FROM_EMAIL: 'WerkFlow' })).toBeUndefined();
});
