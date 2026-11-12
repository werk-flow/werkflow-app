import { describe, expect, test } from 'bun:test';

import { describeSiteRolePeriod, siteRoleState } from './site-roles';

const germanDate = (date: string): string => date.split('-').reverse().join('.');

describe('a role on an Einsatzort is current, ended or upcoming on a Berlin day', () => {
  test('the last day counts as current and the day after as ended', () => {
    expect(siteRoleState({ startsOn: '2020-01-01', endsOn: '2026-06-30' }, '2026-06-30')).toBe('current');
    expect(siteRoleState({ startsOn: '2020-01-01', endsOn: '2026-06-30' }, '2026-07-01')).toBe('ended');
  });

  test('a role without a known start is current until it ends, a later start is upcoming', () => {
    expect(siteRoleState({ startsOn: null, endsOn: null }, '2026-07-01')).toBe('current');
    expect(siteRoleState({ startsOn: '2026-07-02', endsOn: null }, '2026-07-01')).toBe('upcoming');
  });

  test('the period says since when, until when, or that the start is unknown', () => {
    expect(describeSiteRolePeriod({ startsOn: null, endsOn: null }, '2026-07-01', germanDate)).toBe(
      'seit unbekannt',
    );
    expect(describeSiteRolePeriod({ startsOn: '2026-07-01', endsOn: null }, '2026-07-01', germanDate)).toBe(
      'seit 01.07.2026',
    );
    expect(describeSiteRolePeriod({ startsOn: '2026-08-01', endsOn: null }, '2026-07-01', germanDate)).toBe(
      'ab 01.08.2026',
    );
    expect(describeSiteRolePeriod({ startsOn: null, endsOn: '2026-06-30' }, '2026-07-01', germanDate)).toBe(
      'unbekannt – 30.06.2026',
    );
  });
});
