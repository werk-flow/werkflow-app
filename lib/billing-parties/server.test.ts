import { expect, mock, test } from 'bun:test';

// The mapper is pure; its module is server-only.
mock.module('server-only', () => ({}));
const { jobBillingPartiesFrom } = await import('./server');

const row = (version: number, recipientName: string) => ({
  version,
  source: 'buero',
  client_id: 'client-weg',
  recipient_client_id: `recipient-${version}`,
  recipient_name: recipientName,
  recipient_address: null,
  created_at: `2026-11-1${version}T08:00:00.000Z`,
  auftraggeber: { name: 'WEG Lindenstraße 5' },
});

test('the current version leads the job read whatever order its rows arrive in', () => {
  for (const rows of [
    [row(1, 'Erste Verwaltung'), row(3, 'Aktuelle Verwaltung'), row(2, 'Zweite Verwaltung')],
    [row(3, 'Aktuelle Verwaltung'), row(2, 'Zweite Verwaltung'), row(1, 'Erste Verwaltung')],
  ]) {
    const parties = jobBillingPartiesFrom({
      hasClient: true,
      workClient: null,
      versions: rows,
      siteContacts: [],
    });
    expect(parties?.versions.map((version) => version.version)).toEqual([3, 2, 1]);
    expect(parties?.versions[0]?.recipient?.name).toBe('Aktuelle Verwaltung');
  }
});
