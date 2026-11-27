// The WerkFlow KI turn route over the in-memory database. The harness's
// database functions answer here as their SQL does (supabase/tests/ai_threads.sql
// and ai_turn_charges.sql prove the SQL itself); the route, the harness, the
// AI SDK and the replay provider run for real. Each fixture
// process imports the route only after `installAiTurnWorld`.
import { mock } from 'bun:test';
import type { AiModel } from '@/lib/ai/model';
import { z } from '@/lib/zod';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  type ActionWorld,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

type Row = Record<string, unknown>;
type Outcome = { data: unknown; error: { message: string } | null };

export const THREAD_ID = '40000000-0000-4000-8000-000000000001';
export const OTHER_USER_ID = '30000000-0000-4000-8000-000000000002';

const ok = (data: unknown): Outcome => ({ data, error: null });
const raise = (message: string): Outcome => ({ data: null, error: { message } });

export type AiTurnWorld = ActionWorld & {
  /** Runs after each recorded attempt: the change that lands between two model steps. */
  afterAttempt: ((world: AiTurnWorld) => void) | null;
  /** The runs `after()` keeps alive; `settle` awaits them. */
  pending: Promise<unknown>[];
  /** The abort signal of each provider request, in order: whether the harness stopped it. */
  streamSignals: (AbortSignal | undefined)[];
  /** Each provider request as the model received it, in order: what the context builder sent. */
  streamRequests: Parameters<AiModel['doStream']>[0][];
  /** Each send on a thread's live channel, as Realtime's REST API received it. */
  liveSends: Array<{ topic: string; events: unknown[] }>;
  /** Runs at each live send, before it is accepted: what another tab does while the answer is written. */
  onLiveSend: ((events: unknown[]) => Promise<void> | void) | null;
};

export async function installAiTurnWorld(): Promise<AiTurnWorld> {
  process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-ai-turn-secret';
  // The fixtures replay; a key in the shell that runs them must never reach a provider.
  delete process.env.WERKFLOW_KI_ANTHROPIC_KEY;
  process.env.AI_ORGANIZATION_IDS = `${ORGANIZATION_A},${ORGANIZATION_B}`;
  // Live sends never leave the process: Realtime's REST API answers here.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.fixture.invalid';
  process.env.SUPABASE_SECRET_KEY = 'fixture-only-secret-key';
  const base = installActionWorld({});
  const world: AiTurnWorld = Object.assign(base, {
    afterAttempt: null,
    pending: [],
    streamSignals: [],
    streamRequests: [],
    liveSends: [],
    onLiveSend: null,
  });
  installLiveChannel(world);
  mock.module('next/server', () => ({ after: (task: Promise<unknown>) => world.pending.push(task) }));
  // The real replay model, watched: each request's abort signal is kept for the fixture to read.
  const { AI_REPLAY_PROVIDER, createReplayModel } = await import('@/lib/ai/replay');
  mock.module('@/lib/ai/replay', () => ({
    AI_REPLAY_PROVIDER,
    createReplayModel: (modelId: string): AiModel => {
      const model = createReplayModel(modelId);
      return {
        ...model,
        doStream: (options) => {
          world.streamSignals.push(options.abortSignal);
          world.streamRequests.push(options);
          return model.doStream(options);
        },
      };
    },
  }));
  resetAiTables(world);
  world.rpc = (call) => answer(world, call.name, call.args);
  return world;
}

const liveSendSchema = z.object({
  messages: z.array(z.object({ topic: z.string(), event: z.literal('ki'), payload: z.unknown(), private: z.literal(true) })),
});

/** Realtime's REST broadcast, answered in the process: each send is kept, and every other request fails. */
function installLiveChannel(world: AiTurnWorld): void {
  const live = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname !== '/realtime/v1/api/broadcast') throw new Error(`fetch outside this fixture: ${url.host}`);
    const { messages } = liveSendSchema.parse(JSON.parse(String(init?.body)));
    const topics = new Set(messages.map((message) => message.topic));
    if (topics.size !== 1) throw new Error('one live send carries one topic');
    const events = messages.map((message) => message.payload);
    await world.onLiveSend?.(events);
    world.liveSends.push({ topic: [...topics][0] ?? '', events });
    return new Response(null, { status: 202 });
  };
  globalThis.fetch = Object.assign(live, { preconnect: globalThis.fetch.preconnect });
}

export function resetAiTables(world: AiTurnWorld, settings: Row = {}): void {
  world.tables.ai_organization_settings = [
    {
      organization_id: ORGANIZATION_A,
      id: 'switch-a',
      enabled: true,
      monthly_budget_micro_eur: 50_000_000,
      updated_at: null,
      revision: 0,
      ...settings,
    },
  ];
  for (const table of ['ai_threads', 'ai_thread_items', 'ai_runs', 'ai_run_attempts', 'rate_limits']) {
    world.tables[table] = [];
  }
  world.afterAttempt = null;
  world.pending = [];
  world.streamSignals = [];
  world.streamRequests = [];
  world.liveSends = [];
  world.onLiveSend = null;
  world.failingTables.clear();
  signInAs(world, 'employee');
}

function answer(world: AiTurnWorld, name: string, args: Row): Outcome {
  const rows = (table: string): Row[] => tableRows(world, table);
  const organizationId = args.p_organization_id;
  switch (name) {
    case 'consume_rate_limit': {
      const key = `${String(args.p_action)}:${String(args.p_subject_hash)}`;
      const used = rows('rate_limits').filter((row) => row.key === key).length;
      rows('rate_limits').push({ key });
      return ok(used < Number(args.p_max_attempts));
    }
    case 'start_ai_turn':
      return startTurn(world, args);
    case 'update_ai_thread_item': {
      const item = rows('ai_thread_items').find(
        (row) => row.id === args.p_item_id && row.organization_id === organizationId,
      );
      if (!item) return raise('ai_thread_item_not_found');
      if (item.status !== 'streaming') return raise('ai_thread_item_finished');
      Object.assign(item, { status: args.p_status, body: args.p_body });
      return ok(null);
    }
    case 'record_ai_run_attempt': {
      const existing = rows('ai_run_attempts').find(
        (row) => row.organization_id === organizationId && row.idempotency_key === args.p_idempotency_key,
      );
      if (!existing)
        rows('ai_run_attempts').push({
          ...args,
          organization_id: organizationId,
          run_id: args.p_run_id,
          idempotency_key: args.p_idempotency_key,
        });
      world.afterAttempt?.(world);
      return ok('attempt');
    }
    case 'settle_ai_run': {
      const run = rows('ai_runs').find((row) => row.id === args.p_run_id);
      if (run?.status === 'reserved') run.status = args.p_status;
      return ok(attemptCost(world, String(args.p_run_id)));
    }
    default:
      throw new Error(`${name} is outside this fixture`);
  }
}

function attemptCost(world: AiTurnWorld, runId: string): number {
  return tableRows(world, 'ai_run_attempts')
    .filter((row) => row.run_id === runId)
    .reduce((sum, row) => sum + Number(row.p_cost_micro_usd), 0);
}

const OPEN_RUN_MS = 15 * 60_000;
const isOpen = (run: Row): boolean =>
  run.status === 'reserved' && Date.parse(String(run.created_at)) > Date.now() - OPEN_RUN_MS;

/** `start_ai_turn`: the thread, the message, the open-run check, the reservation and the empty answer. */
function startTurn(world: AiTurnWorld, args: Row): Outcome {
  const rows = (table: string): Row[] => tableRows(world, table);
  // An error rolls the whole call back, as the SQL function's transaction does.
  const [threads, items] = [rows('ai_threads').length, rows('ai_thread_items').length];
  const rollBack = (outcome: Outcome): Outcome => {
    rows('ai_threads').splice(threads);
    rows('ai_thread_items').splice(items);
    return outcome;
  };
  const thread = rows('ai_threads').find((row) => row.id === args.p_thread_id);
  if (!thread) {
    rows('ai_threads').push({
      id: args.p_thread_id,
      organization_id: args.p_organization_id,
      user_id: args.p_user_id,
      title: args.p_title,
    });
  } else if (thread.user_id !== args.p_user_id || thread.organization_id !== args.p_organization_id) {
    return raise('ai_thread_not_found');
  }
  const command = String(args.p_command_id);
  const verdict = (name: string): Outcome => ok([{ verdict: name }]);
  const userItem = appendItem(
    world,
    args,
    'user_message',
    'complete',
    { text: args.p_text },
    `${command}:user`,
  );
  if (JSON.stringify(userItem.body) !== JSON.stringify({ text: args.p_text }))
    return verdict('command_conflict');
  const answer = rows('ai_thread_items').find(
    (row) => row.thread_id === args.p_thread_id && row.idempotency_key === `${command}:assistant`,
  );
  if (answer) {
    const commandRuns = rows('ai_runs').filter(
      (run) =>
        run.organization_id === args.p_organization_id && String(run.idempotency_key).startsWith(command),
    );
    if (commandRuns.some(isOpen)) return verdict('run_active');
    if (answer.status === 'streaming') {
      const { text } = z.object({ text: z.string() }).parse(answer.body);
      Object.assign(answer, { status: 'failed', body: { text, failure: 'interrupted' } });
    }
    return verdict('answered');
  }
  if (rows('ai_runs').some((run) => run.user_id === args.p_user_id && isOpen(run)))
    return verdict('run_active');
  const reservation = reserve(world, { ...args, p_idempotency_key: command });
  if (reservation.status === 'raised') return rollBack(reservation.outcome);
  if (reservation.status !== 'reserved') return verdict(reservation.status);
  const answerItem = appendItem(
    world,
    args,
    'assistant_message',
    'streaming',
    { text: '' },
    `${command}:assistant`,
  );
  return ok([
    {
      verdict: 'started',
      run_id: reservation.runId,
      user_item_id: userItem.id,
      user_item_sequence: userItem.sequence,
      answer_item_id: answerItem.id,
      answer_item_sequence: answerItem.sequence,
    },
  ]);
}

function appendItem(
  world: AiTurnWorld,
  args: Row,
  kind: string,
  status: string,
  body: Row,
  idempotencyKey: string,
): Row & { id: string; sequence: number } {
  const all = tableRows(world, 'ai_thread_items');
  const items = all.filter((row) => row.thread_id === args.p_thread_id);
  const existing = items.find((row) => row.idempotency_key === idempotencyKey);
  if (existing) return { ...existing, id: String(existing.id), sequence: Number(existing.sequence) };
  const item = {
    id: `item-${all.length + 1}`,
    organization_id: args.p_organization_id,
    thread_id: args.p_thread_id,
    sequence: items.length + 1,
    kind,
    status,
    body,
    idempotency_key: idempotencyKey,
  };
  all.push(item);
  return item;
}

type Reservation =
  | { status: 'reserved'; runId: string }
  | { status: 'disabled' | 'budget_exhausted' | 'replayed' }
  | { status: 'raised'; outcome: Outcome };

/** `reserve_ai_run`: every open run holds its reservation until it settles, whatever its age. */
function reserve(world: AiTurnWorld, args: Row): Reservation {
  const settings = tableRows(world, 'ai_organization_settings').find(
    (row) => row.organization_id === args.p_organization_id,
  );
  if (!settings?.enabled) return { status: 'disabled' };
  const runs = tableRows(world, 'ai_runs').filter((row) => row.organization_id === args.p_organization_id);
  const existing = runs.find((row) => row.idempotency_key === args.p_idempotency_key);
  if (existing) {
    if (existing.user_id !== args.p_user_id || existing.thread_id !== args.p_thread_id)
      return { status: 'raised', outcome: raise('ai_reservation_key_conflict') };
    if (!isOpen(existing)) return { status: 'raised', outcome: raise('ai_run_closed') };
    return { status: 'replayed' };
  }
  const spent = tableRows(world, 'ai_run_attempts')
    .filter((row) => row.organization_id === args.p_organization_id)
    .reduce((sum, row) => sum + Number(row.p_cost_micro_usd), 0);
  const held = runs
    .filter((row) => row.status === 'reserved')
    .reduce(
      (sum, row) => sum + Math.max(Number(row.reserved_micro_usd) - attemptCost(world, String(row.id)), 0),
      0,
    );
  if (spent + held + Number(args.p_reserve_micro_usd) > Number(settings.monthly_budget_micro_eur)) {
    return { status: 'budget_exhausted' };
  }
  const run = {
    id: `run-${tableRows(world, 'ai_runs').length + 1}`,
    organization_id: args.p_organization_id,
    thread_id: args.p_thread_id,
    user_id: args.p_user_id,
    idempotency_key: args.p_idempotency_key,
    reserved_micro_usd: args.p_reserve_micro_usd,
    status: 'reserved',
    created_at: new Date().toISOString(),
  };
  tableRows(world, 'ai_runs').push(run);
  return { status: 'reserved', runId: run.id };
}

const turnEventSchema = z.object({
  type: z.string(),
  delta: z.string().optional(),
  status: z.string().optional(),
  failure: z.string().optional(),
  message: z.string().optional(),
});
type TurnEvent = z.infer<typeof turnEventSchema>;

/** Posts one turn as the signed-in caller's browser would. */
export async function postTurn(
  text: string,
  options: {
    commandId?: string;
    organizationId?: string;
    threadId?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const { POST } = await import('@/app/api/ki/threads/[threadId]/turns/route');
  const request = new Request(
    `https://app.example.test/api/ki/threads/${options.threadId ?? THREAD_ID}/turns`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...options.headers },
      body: JSON.stringify({
        organizationId: options.organizationId ?? ORGANIZATION_A,
        commandId: options.commandId ?? crypto.randomUUID(),
        text,
      }),
    },
  );
  return POST(request, { params: Promise.resolve({ threadId: options.threadId ?? THREAD_ID }) });
}

/** The streamed events of a started turn, once its run has settled. */
export async function readTurn(world: AiTurnWorld, response: Response): Promise<TurnEvent[]> {
  const body = await response.text();
  await Promise.all(world.pending);
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => turnEventSchema.parse(JSON.parse(line)));
}
