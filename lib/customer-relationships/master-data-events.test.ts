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

  test('a role on an Einsatzort names its kind, holder and day, and a contact’s role its German name', () => {
    const payload = {
      role: 'hausverwaltung',
      holder_client_id: 'holder',
      holder_name: 'Hausverwaltung Lindenhof GmbH',
      site_client_id: 'owner',
      site_name: 'Haus Lindenstraße',
      starts_on: null,
      ends_on: '2026-06-30',
    };
    expect(
      describeMasterDataEvent(customerEvent({ eventType: 'role_ended', isSite: true, payload })),
    ).toEqual({
      reference: 'Hausverwaltung für Haus Lindenstraße beendet',
      detail: 'Hausverwaltung Lindenhof GmbH, letzter Tag 30.06.2026',
    });
    expect(
      describeMasterDataEvent(
        customerEvent({
          eventType: 'role_started',
          isSite: true,
          payload: { ...payload, role: 'eigentuemer', starts_on: '2026-07-01', ends_on: null },
        }),
      ),
    ).toEqual({
      reference: 'Eigentümer für Haus Lindenstraße eingetragen',
      detail: 'Hausverwaltung Lindenhof GmbH, ab 01.07.2026',
    });
    expect(
      describeMasterDataEvent(
        customerEvent({
          isContact: true,
          contactName: 'Max Mieter',
          payload: { field: 'site_role', old: 'mieter', new: 'zugangskontakt' },
        }),
      ),
    ).toEqual({
      reference: 'Ansprechpartner Max Mieter: Rolle am Einsatzort geändert',
      detail: '„Mieter“ → „Zugangskontakt“',
    });
  });
});
