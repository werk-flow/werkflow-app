import { describe, expect, test } from 'bun:test';

import { MADE_UP_SELLER } from '@/lib/testing/fixtures/stripe-invoices';
import { readWerkflowSeller } from '@/lib/werkflow-billing/seller';

// WerkFlow's seller block is server configuration. A sole trader under § 19
// UStG has a Steuernummer and a creditor ID, but no USt-IdNr. and no register
// entry; the creditor ID identifies the seller (BT-29) in their place.

const SOLE_TRADER = {
  WERKFLOW_SELLER_NAME: 'Musterfirma Software, Erika Musterfrau',
  WERKFLOW_SELLER_STREET: 'Musterstraße 1',
  WERKFLOW_SELLER_POSTAL_CODE: '01234',
  WERKFLOW_SELLER_CITY: 'Musterstadt',
  WERKFLOW_SELLER_TAX_NUMBER: '12/345/67890',
  WERKFLOW_SELLER_EMAIL: 'rechnung@musterfirma.example',
  WERKFLOW_SELLER_CREDITOR_ID: 'DE98ZZZ09999999999',
};

describe('readWerkflowSeller', () => {
  test('a seller without USt-IdNr. and register number is identified by its creditor ID, without scheme', () => {
    expect(readWerkflowSeller({ ...SOLE_TRADER, WERKFLOW_SELLER_VAT_ID: ' ' })).toEqual(MADE_UP_SELLER);
  });

  test('a missing creditor ID fails closed', () => {
    expect(() => readWerkflowSeller({ ...SOLE_TRADER, WERKFLOW_SELLER_CREDITOR_ID: '' })).toThrow(
      expect.objectContaining({ code: 'werkflow_seller_configuration_missing' }),
    );
  });
});
