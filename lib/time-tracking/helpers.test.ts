import { describe, expect, test } from 'bun:test';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';

import {
  canApproveEntries,
  canManageEntries,
  formatDuration,
  formatSignedDuration,
  liveMinutes,
} from './helpers';

describe('canManageEntries: who edits or deletes an entry directly', () => {
  test('Büro manages employees but never their own entries, which go through a Zeitkorrektur', () => {
    expect(canManageEntries('buero', 'employee', false)).toBe(true);
    expect(canManageEntries('buero', 'buero', true)).toBe(false);
    expect(canManageEntries('buero', 'buero', false)).toBe(false);
    expect(canManageEntries('buero', 'admin', false)).toBe(false);
  });

  test('Admin manages every entry, their own included; an employee manages none', () => {
    expect(canManageEntries('admin', 'admin', true)).toBe(true);
    expect(canManageEntries('admin', 'buero', false)).toBe(true);
    expect(canManageEntries('employee', 'employee', true)).toBe(false);
  });
});

describe('liveMinutes', () => {
  const nowMs = Date.parse('2026-09-03T10:30:00.000Z');

  test('adds the minutes a running status has added since it started', () => {
    expect(liveMinutes(120, '2026-09-03T10:00:00.000Z', nowMs)).toBe(150);
    expect(liveMinutes(0, '2026-09-03T10:29:30.000Z', nowMs)).toBe(0.5);
  });

  test('adds nothing when nothing runs, the start is unreadable or lies ahead of the clock', () => {
    expect(liveMinutes(120, null, nowMs)).toBe(120);
    expect(liveMinutes(120, 'kein Zeitpunkt', nowMs)).toBe(120);
    expect(liveMinutes(120, '2026-09-03T10:31:00.000Z', nowMs)).toBe(120);
  });
});

describe('formatDuration', () => {
  test('renders minutes, hours, or both in German units', () => {
    expect(formatDuration(0)).toBe('0 Min.');
    expect(formatDuration(45)).toBe('45 Min.');
    expect(formatDuration(120)).toBe('2 Std.');
    expect(formatDuration(510)).toBe('8 Std. 30 Min.');
  });

  test('rounds to whole minutes before splitting, so no part reads 60 Min.', () => {
    expect(formatDuration(44.4)).toBe('44 Min.');
    expect(formatDuration(119.6)).toBe('2 Std.');
    expect(formatDuration(89.5)).toBe('1 Std. 30 Min.');
  });
});

describe('formatSignedDuration', () => {
  test('prefixes the sign and formats the magnitude', () => {
    expect(formatSignedDuration(90)).toBe('+1 Std. 30 Min.');
    expect(formatSignedDuration(-45)).toBe('−45 Min.');
    expect(formatSignedDuration(-120)).toBe('−2 Std.');
  });

  test('counts zero as positive', () => {
    expect(formatSignedDuration(0)).toBe('+0 Min.');
  });
});

describe('canApproveEntries: the one approval predicate of the server and every review surface', () => {
  const roleDefault = (role: 'admin' | 'buero'): EffectiveResponsibilityHolder => ({
    employeeRecordId: `${role}-record`,
    userId: `${role}-user`,
    source: { kind: 'role_default', configurationId: null, role },
  });

  test('an admin holder never approves their own pending entry, as the server refuses it', () => {
    expect(canApproveEntries(roleDefault('admin'), 'admin-user', 'admin')).toBe(false);
    expect(canApproveEntries(roleDefault('admin'), 'buero-user', 'buero')).toBe(true);
  });

  test('a Büro source approves employees only, also when delegated', () => {
    expect(canApproveEntries(roleDefault('buero'), 'other-buero-user', 'buero')).toBe(false);
    expect(canApproveEntries(roleDefault('buero'), 'employee-user', 'employee')).toBe(true);
    const delegated: EffectiveResponsibilityHolder = {
      employeeRecordId: 'employee-record',
      userId: 'substitute-user',
      source: {
        kind: 'delegation',
        configurationId: null,
        delegationId: 'delegation',
        delegatedFromEmployeeRecordId: 'buero-record',
        validFrom: '2026-10-01',
        validUntil: '2026-10-31',
        inheritedSource: { kind: 'role_default', configurationId: null, role: 'buero' },
      },
    };
    expect(canApproveEntries(delegated, 'buero-user', 'buero')).toBe(false);
    expect(canApproveEntries(delegated, 'employee-user', 'employee')).toBe(true);
    expect(canApproveEntries(delegated, 'substitute-user', 'employee')).toBe(false);
  });

  test('a caller without a time_approval holder approves nothing, whatever the role', () => {
    expect(canApproveEntries(null, 'employee-user', 'employee')).toBe(false);
  });
});
