import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { planTestWorld } from '../seed-world-plan';

// Isolated process: replace external providers while exercising the real teardown.
const deletedTables: string[] = [];
const deletedUsers: string[] = [];
const deletedStoragePrefixes: string[] = [];
const mailboxRecipients: string[] = [];

mock.module('@supabase/supabase-js', () => ({ createClient: () => ({
  from: (table: string) => ({
    select: () => ({ in: () => ({ or: async () => ({ data: [], error: null }) }) }),
    delete: () => ({ in: async () => {
      deletedTables.push(table);
      return { error: null };
    } }),
  }),
  auth: { admin: { deleteUser: async (id: string) => {
    deletedUsers.push(id);
    return { error: null };
  } } },
}) }));
mock.module('../../storage/r2', () => ({
  listStorageObjectPaths: async (prefix: string) => {
    deletedStoragePrefixes.push(prefix);
    return [];
  },
  deleteStorageObjects: async () => {},
}));
mock.module('../local-mailpit', () => ({
  localMailpitUrl: () => new URL('http://127.0.0.1:54324'),
  deleteOwnedMailpitMessages: async (_url: URL, emails: readonly string[]) => { mailboxRecipients.push(...emails); },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SECRET_KEY = 'fixture-only';
const { destroyTestWorld, worldUserIds } = await import('../../../tests/golden/support/seed');
const world = planTestWorld();
world.users.admin.email = 'unowned@example.invalid';

await assert.rejects(destroyTestWorld(world), /cleanup incomplete:[\s\S]*Mailpit cleanup recipient does not belong/);
assert(!mailboxRecipients.includes(world.users.admin.email));
assert(mailboxRecipients.includes(world.users.employee.email));
assert(mailboxRecipients.includes(world.invitee.email));
assert(mailboxRecipients.includes(world.personnelInvitee.email));
assert.deepEqual(deletedStoragePrefixes.sort(), [`${world.orgId}/`, `${world.outsider.orgId}/`].sort());
assert.deepEqual(deletedTables, ['organization_responsibility_configurations', 'organizations', 'subscriptions']);
assert.deepEqual(deletedUsers.sort(), worldUserIds(world).sort());
