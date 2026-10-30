import { expect, test } from 'bun:test';

import { getSettingsSectionsByGroup } from '@/lib/settings/sections';
import type { OrgRole } from '@/lib/roles';

const tabs = (role: OrgRole) => ({
  account: getSettingsSectionsByGroup('account', role).map((section) => section.label),
  organization: getSettingsSectionsByGroup('organization', role).map((section) => section.label),
});

// An employee's settings hold their own profile, account, Aufträge columns and
// responsibilities. The organization forms Admin changes stay out of the way,
// and the personal table view sits under „Persönlich“ for every role.
test('an employee sees only their own settings sections', () => {
  expect(tabs('employee')).toEqual({
    account: ['Profil', 'Konto & Sicherheit', 'Aufträge & Projekte'],
    organization: ['Mitarbeiter'],
  });
});

test('Admin and Büro see every settings section, with the personal table view under „Persönlich“', () => {
  for (const role of ['admin', 'buero'] as const) {
    expect(tabs(role), role).toEqual({
      account: ['Profil', 'Konto & Sicherheit', 'Aufträge & Projekte', 'Abonnement & Abrechnung'],
      organization: ['Dashboard', 'Organisation', 'Kalender', 'Zeiterfassung', 'Mitarbeiter', 'Kunden'],
    });
  }
});
