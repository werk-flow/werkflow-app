import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { testAiOrganizationId } from '../../../../lib/testing/ai-test-organization';
import {
  createOrganizationWithSettings,
  createTestUser,
  goldenTestEmail,
  goldenTestOrganizationName,
} from '../seed';
import type { TestUser, TestWorld } from '../world';
import { createAdminClient } from './shared';

export type KiRole = 'admin' | 'buero' | 'employee';
export type KiOrganization = { organizationId: string; users: Record<KiRole, TestUser> };

/** A UUID that follows from its seed, so a later test of the run finds the same record. */
function seededUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function kiUser(world: TestWorld, role: KiRole, firstName: string): TestUser {
  return {
    id: seededUuid(`${world.runId}:ki:${role}`),
    email: goldenTestEmail(`ki-${role}`, world.runId),
    password: `GgKi!${world.runId}#2026`,
    firstName,
    lastName: 'Kirsch',
  };
}

/** Creates the people a set-up attempt of this run has not created yet. */
async function createMissingUsers(
  admin: ReturnType<typeof createAdminClient>,
  users: TestUser[],
): Promise<void> {
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .in(
      'id',
      users.map((user) => user.id),
    )
    .throwOnError();
  const created = new Set(existing.map((profile) => profile.id));
  for (const user of users) if (!created.has(user.id)) await createTestUser(admin, user);
}

/** Whether the organization is this run's and its set-up finished: switching WerkFlow KI on is its last write. */
async function setUpForRun(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  name: string,
  existing: { name: string } | null,
): Promise<boolean> {
  if (existing?.name !== name) return false;
  const { data: settings } = await admin
    .from('ai_organization_settings')
    .select('enabled')
    .eq('organization_id', organizationId)
    .maybeSingle()
    .throwOnError();
  return settings?.enabled === true;
}

/**
 * This checkout's KI organization, the one the local test server releases
 * (lib/testing/ai-test-organization.ts), with WerkFlow KI switched on and its
 * own three people, so the world's roles keep one organization. Seeded once
 * per run; an attempt that stopped part-way is set up again, with the people
 * it already created. The world owns the people's addresses and the
 * organization's name, so its teardown removes both.
 */
export async function kiOrganizationFor(world: TestWorld): Promise<KiOrganization> {
  const admin = createAdminClient();
  const organizationId = testAiOrganizationId(resolve(__dirname, '../../../..'));
  const name = goldenTestOrganizationName('KI', world.runId);
  const users = {
    admin: kiUser(world, 'admin', 'Karla'),
    buero: kiUser(world, 'buero', 'Konrad'),
    employee: kiUser(world, 'employee', 'Kim'),
  };
  const { data: existing } = await admin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .maybeSingle()
    .throwOnError();
  if (await setUpForRun(admin, organizationId, name, existing)) return { organizationId, users };
  // A crashed run's organization, or this run's half set-up one, would still hold the id.
  if (existing) await admin.from('organizations').delete().eq('id', organizationId).throwOnError();
  await createMissingUsers(admin, Object.values(users));
  await admin.from('subscriptions').delete().eq('user_id', users.admin.id).throwOnError();
  await admin
    .from('subscriptions')
    .insert({ user_id: users.admin.id, status: 'active', plan_id: 'golden-test' })
    .throwOnError();
  await createOrganizationWithSettings(admin, organizationId, name, users.admin.id);
  await admin
    .from('organization_members')
    .insert([
      { organization_id: organizationId, user_id: users.buero.id, role: 'buero' },
      { organization_id: organizationId, user_id: users.employee.id, role: 'employee' },
    ])
    .throwOnError();
  await admin
    .rpc('set_ai_organization_enabled', {
      p_organization_id: organizationId,
      p_actor_id: users.admin.id,
      p_enabled: true,
    })
    .throwOnError();
  return { organizationId, users };
}

/** A thread of the person with finished messages, written through the harness's own database functions. */
export async function seedKiThread(
  ki: KiOrganization,
  role: KiRole,
  messages: readonly { role: 'user' | 'assistant'; text: string }[],
): Promise<string> {
  const admin = createAdminClient();
  const threadId = seededUuid(`${ki.users[role].id}:${messages.map((message) => message.text).join('|')}`);
  const author = { p_organization_id: ki.organizationId, p_user_id: ki.users[role].id };
  await admin
    .rpc('create_ai_thread', { ...author, p_thread_id: threadId, p_title: messages[0]?.text ?? 'Chat' })
    .throwOnError();
  for (const [index, message] of messages.entries()) {
    await admin
      .rpc('append_ai_thread_item', {
        ...author,
        p_thread_id: threadId,
        p_kind: message.role === 'user' ? 'user_message' : 'assistant_message',
        p_status: 'complete',
        p_body: { text: message.text },
        p_idempotency_key: `seed:${index}`,
      })
      .throwOnError();
  }
  return threadId;
}
