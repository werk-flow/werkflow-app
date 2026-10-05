import { describe, expect, test } from 'bun:test';

import { buildContactEcho, buildSiteEcho, withPendingPrimary } from './relation-echo';
import type { ClientContact } from './types';

const stored: ClientContact = {
  id: 'contact-1',
  organizationId: 'org-1',
  clientId: 'client-1',
  name: 'Sabine Krause',
  role: 'Hausverwaltung',
  email: null,
  phone: '030 1234',
  notes: null,
  isPrimary: true,
  isActive: true,
  createdBy: 'user-1',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

describe('client relation echo', () => {
  test('a new contact echo is active and stores blank text as empty', () => {
    const echo = buildContactEcho(
      { id: 'pending-1', clientId: 'client-1' },
      { name: ' Jan Vogt ', role: '  ', isPrimary: true },
    );
    expect(echo).toMatchObject({
      id: 'pending-1',
      clientId: 'client-1',
      name: 'Jan Vogt',
      role: null,
      isPrimary: true,
      isActive: true,
    });
  });

  test('an edited contact keeps its identity and stored facts', () => {
    const echo = buildContactEcho(stored, { name: 'Sabine Krause', phone: '030 9999', isPrimary: false });
    expect(echo).toMatchObject({
      id: 'contact-1',
      organizationId: 'org-1',
      createdBy: 'user-1',
      phone: '030 9999',
      role: null,
      isPrimary: false,
    });
  });

  test('a site echo carries the address and the contact on site', () => {
    const echo = buildSiteEcho(
      { id: 'pending-2', clientId: 'client-1' },
      { name: 'Hauptgebäude', street: 'Am Ring 4', primaryContactId: 'contact-1' },
    );
    expect(echo).toMatchObject({
      name: 'Hauptgebäude',
      street: 'Am Ring 4',
      postalCode: null,
      primaryContactId: 'contact-1',
      isPrimary: false,
      isActive: true,
    });
  });

  test('a pending primary choice clears the previous mark and a confirmed list stays unchanged', () => {
    const pending = { ...stored, id: 'pending-1', name: 'Jan Vogt' };
    expect(
      withPendingPrimary([
        { item: stored, isOptimistic: false },
        { item: pending, isOptimistic: true },
      ]).map((row) => row.isPrimary),
    ).toEqual([false, true]);
    expect(withPendingPrimary([{ item: stored, isOptimistic: false }])).toEqual([stored]);
  });
});
