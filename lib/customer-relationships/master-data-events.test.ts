import { describe, expect, test } from 'bun:test';

import { describeMasterDataEvent, type MasterDataEvent } from './master-data-events';

const customerEvent = (overrides: Partial<MasterDataEvent>): MasterDataEvent => ({
  eventType: 'changed',
  payload: {},
  contactName: null,
  siteName: null,
  isContact: false,
  isSite: false,
  ...overrides,
});

describe('the chronology names each master-data change with its old and new value', () => {
  test('a customer field change shows the field and both values, an empty value as „leer“', () => {
    expect(
      describeMasterDataEvent(customerEvent({ payload: { field: 'phone', old: '030 1111111', new: null } })),
    ).toEqual({ reference: 'Telefon geändert', detail: '„030 1111111“ → leer' });
  });

  test('a customer type change shows the German type names', () => {
    expect(
      describeMasterDataEvent(
        customerEvent({ payload: { field: 'client_type', old: 'privat', new: 'gewerblich' } }),
      ),
    ).toEqual({ reference: 'Kundentyp geändert', detail: '„Privat“ → „Gewerblich“' });
  });

  test('a contact or site change names the contact or site', () => {
    expect(
      describeMasterDataEvent(
        customerEvent({
          isContact: true,
          contactName: 'Erika Musterfrau',
          payload: { field: 'email', old: 'a@example.test', new: 'b@example.test' },
        }),
      ).reference,
    ).toBe('Ansprechpartner Erika Musterfrau: E-Mail geändert');
    expect(
      describeMasterDataEvent(customerEvent({ isSite: true, siteName: 'Haus Nord', eventType: 'archived' })),
    ).toEqual({ reference: 'Einsatzort Haus Nord archiviert', detail: null });
  });

  test('archiving and restoring the customer have no values', () => {
    expect(describeMasterDataEvent(customerEvent({ eventType: 'archived' })).reference).toBe(
      'Kunde archiviert',
    );
    expect(describeMasterDataEvent(customerEvent({ eventType: 'restored' })).reference).toBe(
      'Kunde wiederhergestellt',
    );
  });

  test('an unknown payload still shows that something changed', () => {
    expect(describeMasterDataEvent(customerEvent({ payload: { field: 7 } }))).toEqual({
      reference: 'Kunde geändert',
      detail: null,
    });
  });
});
