import { describe, expect, test } from 'bun:test';

import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';
import { formatProfileName, getInitials, getManagerAssigneeOptions } from './profile-name';

type AssigneeAdminClient = Parameters<typeof getManagerAssigneeOptions>[0];

const ORGANIZATION = 'organization-1';
const OTHER_ORGANIZATION = 'organization-2';

async function assigneeOptions(tables: InMemoryTables, organizationId = ORGANIZATION) {
  // Test double: the in-memory client implements only the query-builder calls this read uses.
  const admin = createInMemoryAdmin(tables) as unknown as AssigneeAdminClient;
  const result = await getManagerAssigneeOptions(admin, organizationId);
  if (!result.success) throw new Error(result.error);
  return result.options;
}

describe('formatProfileName', () => {
  test('joins the name parts that exist', () => {
    expect(formatProfileName({ first_name: 'Erika', last_name: 'Muster', email: 'erika@example.test' })).toBe(
      'Erika Muster',
    );
    expect(formatProfileName({ first_name: null, last_name: 'Muster', email: 'erika@example.test' })).toBe(
      'Muster',
    );
    expect(formatProfileName({ first_name: 'Erika', last_name: '', email: null })).toBe('Erika');
  });

  test('falls back to the email address and then to a placeholder', () => {
    expect(formatProfileName({ first_name: null, last_name: null, email: 'erika@example.test' })).toBe(
      'erika@example.test',
    );
    expect(formatProfileName({ first_name: '', last_name: '', email: null })).toBe('Unbekannt');
  });
});

describe('getInitials', () => {
  test('uses the upper-cased first letter of each name part that exists', () => {
    expect(getInitials('erika', 'muster')).toBe('EM');
    expect(getInitials('Özlem', null)).toBe('Ö');
    expect(getInitials(null, 'Muster')).toBe('M');
    expect(getInitials(null, null)).toBe('');
  });
});

describe('getManagerAssigneeOptions', () => {
  const tables: InMemoryTables = {
    organization_members: [
      { organization_id: ORGANIZATION, user_id: 'office', role: 'buero' },
      { organization_id: ORGANIZATION, user_id: 'owner', role: 'admin' },
      { organization_id: ORGANIZATION, user_id: 'worker', role: 'employee' },
      { organization_id: ORGANIZATION, user_id: 'no-profile', role: 'buero' },
      { organization_id: OTHER_ORGANIZATION, user_id: 'foreign-owner', role: 'admin' },
    ],
    profiles: [
      { id: 'office', first_name: 'Zoe', last_name: 'Zimmer', email: 'zoe@example.test' },
      { id: 'owner', first_name: 'Ärmel', last_name: 'Adam', email: 'adam@example.test' },
      { id: 'worker', first_name: 'Willi', last_name: 'Worker', email: 'willi@example.test' },
      { id: 'foreign-owner', first_name: 'Frieda', last_name: 'Fremd', email: 'frieda@example.test' },
    ],
  };

  test('offers the admin and office members of the organization, sorted by German collation', async () => {
    expect(await assigneeOptions(tables)).toEqual([
      { userId: 'owner', name: 'Ärmel Adam' },
      { userId: 'no-profile', name: 'Unbekannt' },
      { userId: 'office', name: 'Zoe Zimmer' },
    ]);
  });

  test('never offers field workers or members of another organization', async () => {
    const userIds = (await assigneeOptions(tables)).map((option) => option.userId);
    expect(userIds).not.toContain('worker');
    expect(userIds).not.toContain('foreign-owner');
    expect(await assigneeOptions(tables, OTHER_ORGANIZATION)).toEqual([
      { userId: 'foreign-owner', name: 'Frieda Fremd' },
    ]);
  });

  test('a failed member read is load_failed, never an empty list', async () => {
    const failing = {
      from: () => ({
        select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { code: 'XX000' } }) }) }),
      }),
    } as unknown as AssigneeAdminClient;
    expect(await getManagerAssigneeOptions(failing, ORGANIZATION)).toEqual({
      success: false,
      error: 'load_failed',
    });
  });

  test('returns no options for an organization without managers', async () => {
    expect(await assigneeOptions({ organization_members: [], profiles: [] })).toEqual([]);
  });
});
