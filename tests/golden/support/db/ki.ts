import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { AiChatFile } from '../../../../lib/ai/thread-types';
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
  messages: readonly ({ role: 'user' | 'assistant'; text: string } | { role: 'file'; file: AiChatFile })[],
): Promise<string> {
  const admin = createAdminClient();
  const texts = messages.map((message) => (message.role === 'file' ? message.file.name : message.text));
  const threadId = seededUuid(`${ki.users[role].id}:${texts.join('|')}`);
  const author = { p_organization_id: ki.organizationId, p_user_id: ki.users[role].id };
  await admin
    .rpc('create_ai_thread', { ...author, p_thread_id: threadId, p_title: texts[0] ?? 'Chat' })
    .throwOnError();
  for (const [index, message] of messages.entries()) {
    await admin
      .rpc('append_ai_thread_item', {
        ...author,
        p_thread_id: threadId,
        p_kind: ({ file: 'file', user: 'user_message', assistant: 'assistant_message' } as const)[
          message.role
        ],
        p_status: 'complete',
        // A file item carries only its card's facts: the capture opens no bytes.
        p_body: message.role === 'file' ? message.file : { text: message.text },
        p_idempotency_key: `seed:${index}`,
      })
      .throwOnError();
  }
  return threadId;
}

/** The customer the seeded tool call of `seedKiTurnWithRows` finds. */
export const KI_SEEDED_CUSTOMER = 'Müller Haustechnik';

type SeededItem = { idempotency_key: string; kind: string; status: string; body: unknown };

/** The rows a capture of the seeded turn reads, by key, as its last write leaves them. */
const seededTurnRows = (command: string) => [
  { key: `${command}:plan`, kind: 'todo_list', revision: 3 },
  { key: `${command}:tool:2`, kind: 'tool_call', revision: 2 },
  { key: `${command}:assistant`, kind: 'assistant_message', revision: null },
  { key: `${command}:tool:4`, kind: 'question', revision: 1 },
];

const revisionOf = (body: unknown): number | null =>
  typeof body === 'object' && body !== null && 'revision' in body && typeof body.revision === 'number'
    ? body.revision
    : null;

/** The keys of the seeded turn's rows the thread lacks or holds short of their last write. */
export function unfinishedSeededRows(items: readonly SeededItem[], command: string): string[] {
  return seededTurnRows(command).flatMap((expected) => {
    const item = items.find((entry) => entry.idempotency_key === expected.key);
    const finished =
      item?.kind === expected.kind &&
      item.status === 'complete' &&
      revisionOf(item.body) === expected.revision;
    return finished ? [] : [expected.key];
  });
}

/**
 * Seeds one finished turn in which the agent worked through its harness
 * (werk-flow/werkflow-planning#533): a ticked plan, a customer search with its
 * input and result, the answer and a question with options, written through
 * the database calls a live turn makes. A repeat finds the turn already
 * started and writes nothing; it fails unless an earlier attempt wrote every
 * row the capture reads.
 */
async function seedKiTurnWithRows(ki: KiOrganization, role: KiRole, text: string): Promise<string> {
  const admin = createAdminClient();
  const threadId = seededUuid(`${ki.users[role].id}:rows:${text}`);
  const command = seededUuid(`${threadId}:command`);
  const author = { p_organization_id: ki.organizationId, p_user_id: ki.users[role].id };
  const { data } = await admin
    .rpc('start_ai_turn', {
      ...author,
      p_thread_id: threadId,
      p_title: text,
      p_command_id: command,
      p_text: text,
      p_reserve_micro_usd: 1000,
    })
    .single()
    .throwOnError();
  if (data.verdict !== 'started' || !data.run_id || !data.answer_item_id) {
    const { data: items } = await admin
      .from('ai_thread_items')
      .select('idempotency_key, kind, status, body')
      .eq('thread_id', threadId)
      .throwOnError();
    const unfinished = unfinishedSeededRows(items, command);
    if (unfinished.length > 0)
      throw new Error(
        `The KI turn seed stopped part-way (${data.verdict}): thread ${threadId} lacks ${unfinished.join(', ')}.`,
      );
    return threadId;
  }
  const run = { ...author, p_run_id: data.run_id };
  const ledger = (key: string, tool: string) => ({
    p_ledger_key: key,
    p_model_id: 'seed',
    p_prompt_version: 'seed',
    p_outcome: `tool_call_${tool}_ok`,
  });
  const steps = (done: boolean) => [
    { text: 'Kunden suchen', done: true },
    { text: 'Ansprechpartner nennen', done },
  ];
  await admin
    .rpc('record_ai_tool_item', {
      ...run,
      p_kind: 'todo_list',
      p_status: 'complete',
      p_item_key: `${command}:plan`,
      p_body: { revision: 1, steps: steps(false) },
      ...ledger(`${command}:tool:1`, 'plan_zeigen'),
    })
    .throwOnError();
  await admin
    .rpc('record_ai_tool_item', {
      ...run,
      p_kind: 'tool_call',
      p_status: 'complete',
      p_item_key: `${command}:tool:2`,
      p_body: {
        revision: 2,
        label: 'Kunden und Einsatzorte finden',
        control: 'read',
        outcome: 'ok',
        detail: true,
      },
      p_detail: {
        input: { suche: 'Müller' },
        result: {
          kunden: [
            {
              kundeId: seededUuid(`${threadId}:kunde-1`),
              name: { source: 'record_text', text: KI_SEEDED_CUSTOMER },
              kundennummer: { source: 'record_text', text: 'K-1001' },
              adresse: { source: 'record_text', text: 'Lindenstraße 1, 70173 Stuttgart' },
              link: '/kunden',
            },
            {
              kundeId: seededUuid(`${threadId}:kunde-2`),
              name: { source: 'record_text', text: 'Müller Bau GmbH' },
              kundennummer: { source: 'record_text', text: 'K-1002' },
              adresse: { source: 'record_text', text: 'Hauptstraße 12, 70178 Stuttgart' },
              link: '/kunden',
            },
          ],
          gesamt: 2,
        },
      },
      ...ledger(`${command}:tool:2`, 'kunden_finden'),
    })
    .throwOnError();
  await admin
    .rpc('record_ai_tool_item', {
      ...run,
      p_kind: 'todo_list',
      p_status: 'complete',
      p_item_key: `${command}:plan`,
      p_body: { revision: 3, steps: steps(true) },
      ...ledger(`${command}:tool:3`, 'plan_zeigen'),
    })
    .throwOnError();
  await admin
    .rpc('update_ai_thread_item', {
      ...author,
      p_item_id: data.answer_item_id,
      p_status: 'complete',
      p_body: { text: 'Ich habe zwei Kunden mit „Müller“ gefunden: Müller Haustechnik und Müller Bau GmbH.' },
    })
    .throwOnError();
  await admin
    .rpc('record_ai_tool_item', {
      ...run,
      p_kind: 'question',
      p_status: 'complete',
      p_item_key: `${command}:tool:4`,
      p_body: {
        revision: 1,
        question: 'Welchen Kunden meinst du?',
        options: [KI_SEEDED_CUSTOMER, 'Müller Bau GmbH'],
      },
      ...ledger(`${command}:tool:4`, 'frage_stellen'),
    })
    .throwOnError();
  await admin
    .rpc('settle_ai_run', {
      p_organization_id: ki.organizationId,
      p_run_id: data.run_id,
      p_status: 'succeeded',
    })
    .throwOnError();
  return threadId;
}

/** The admin's thread of `seedKiTurnWithRows` in the run's KI organization, as a capture's destination. */
export async function kiThreadWithRows(world: TestWorld): Promise<{ route: string }> {
  const ki = await kiOrganizationFor(world);
  const threadId = await seedKiTurnWithRows(ki, 'admin', 'Welche Kunden heißen Müller?');
  return { route: `/ki?chat=${threadId}` };
}
