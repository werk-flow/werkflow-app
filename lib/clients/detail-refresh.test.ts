import { describe, expect, test } from 'bun:test';

import type { RealtimeChangeEvent } from '@/lib/realtime/events';
import { isCustomerDetailEvent, roleRelatedRecords } from './detail-refresh';
import type { ClientSiteRole } from './site-roles';

const page = 'hausverwaltung';
const role: ClientSiteRole = {
  id: 'role-1',
  siteId: 'site-of-weg',
  siteName: 'Haus Lindenstraße',
  siteAddress: 'Lindenstraße 5, 10115 Berlin',
  siteSourceNumber: null,
  siteIsActive: true,
  siteClientId: 'weg',
  siteClientName: 'WEG Lindenstraße 5',
  holderClientId: page,
  holderName: 'Hausverwaltung Lindenhof GmbH',
  holderArchived: false,
  role: 'hausverwaltung',
  startsOn: null,
  endsOn: null,
};
const related = roleRelatedRecords([role]);
const update = (table: RealtimeChangeEvent['table'], row: Record<string, unknown>): RealtimeChangeEvent => ({
  table,
  eventType: 'UPDATE',
  new: row,
  old: null,
});

describe('a customer page hears the changes its roles show', () => {
  test('a rename of the owner it manages for and an address change of a managed Einsatzort refresh it', () => {
    expect(isCustomerDetailEvent(update('clients', { id: 'weg' }), page, related)).toBe(true);
    expect(
      isCustomerDetailEvent(update('client_sites', { id: 'site-of-weg', client_id: 'weg' }), page, related),
    ).toBe(true);
    expect(
      isCustomerDetailEvent(
        update('client_site_roles', { client_id: 'weg', holder_client_id: page }),
        page,
        related,
      ),
    ).toBe(true);
  });

  test('an unrelated customer or Einsatzort leaves it alone', () => {
    expect(isCustomerDetailEvent(update('clients', { id: 'other' }), page, related)).toBe(false);
    expect(
      isCustomerDetailEvent(update('client_sites', { id: 'other-site', client_id: 'other' }), page, related),
    ).toBe(false);
  });
});
