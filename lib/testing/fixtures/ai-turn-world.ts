// The WerkFlow KI turn route over the in-memory database. The six harness
// functions of werk-flow/werkflow-planning#527 answer here as their SQL
// does (supabase/tests/ai_threads.sql proves the SQL itself); the route, the
// harness, the AI SDK and the replay provider run for real. Each fixture
// process imports the route only after `installAiTurnWorld`.
import { mock } from 'bun:test';
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
};

export function installAiTurnWorld(): AiTurnWorld {
  process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-ai-turn-secret';
  process.env.AI_ORGANIZATION_IDS = `${ORGANIZATION_A},${ORGANIZATION_B}`;
  const base = installActionWorld({});
  const world: AiTurnWorld = Object.assign(base, { afterAttempt: null, pending: [] });
  mock.module('next/server', () => ({ after: (task: Promise<unknown>) => world.pending.push(task) }));
  resetAiTables(world);
  world.rpc = (call) => answer(world, call.name, call.args);
  return world;
}

export function resetAiTables(world: AiTurnWorld, settings: Row = {}): void {
  world.tables.ai_organization_settings = [
    {
      organization_id: ORGANIZATION_A,
      id: 'switch-a',
      enabled: true,
      monthly_budget_micro_eur: 50_000_000,
      updated_at: null,
      ...settings,
    },
  ];
  for (const table of ['ai_threads', 'ai_thread_items', 'ai_runs', 'ai_run_attempts', 'rate_limits']) {
    world.tables[table] = [];
  }
  world.afterAttempt = null;
  world.pending = [];
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
    case 'create_ai_thread': {
      const thread = rows('ai_threads').find((row) => row.id === args.p_thread_id);
      if (!thread) {
        rows('ai_threads').push({
          id: args.p_thread_id,
          organization_id: organizationId,
          user_id: args.p_user_id,
          title: args.p_title,
        });
      } else if (thread.user_id !== args.p_user_id || thread.organization_id !== organizationId) {
        return raise('ai_thread_not_found');
      }
      return ok(args.p_thread_id);
    }
    case 'reserve_ai_run':
      return reserve(world, args);
    case 'append_ai_thread_item': {
      const items = rows('ai_thread_items').filter((row) => row.thread_id === args.p_thread_id);
      const existing = items.find((row) => row.idempotency_key === args.p_idempotency_key);
      const item = existing ?? {
        id: `item-${rows('ai_thread_items').length + 1}`,
        organization_id: organizationId,
        thread_id: args.p_thread_id,
        sequence: items.length + 1,
        kind: args.p_kind,
        status: args.p_status,
        body: args.p_body,
        idempotency_key: args.p_idempotency_key,
      };
      if (!existing) rows('ai_thread_items').push(item);
      return ok([{ item_id: item.id, item_sequence: item.sequence }]);
    }
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

function reserve(world: AiTurnWorld, args: Row): Outcome {
  const settings = tableRows(world, 'ai_organization_settings').find(
    (row) => row.organization_id === args.p_organization_id,
  );
  if (!settings?.enabled) return ok([{ run_id: null, verdict: 'disabled' }]);
  const runs = tableRows(world, 'ai_runs').filter((row) => row.organization_id === args.p_organization_id);
  const existing = runs.find((row) => row.idempotency_key === args.p_idempotency_key);
  if (existing) {
    if (existing.user_id !== args.p_user_id || existing.thread_id !== args.p_thread_id)
      return raise('ai_reservation_key_conflict');
    if (existing.status !== 'reserved') return raise('ai_run_closed');
    return ok([{ run_id: existing.id, verdict: 'replayed' }]);
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
    return ok([{ run_id: null, verdict: 'budget_exhausted' }]);
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
  return ok([{ run_id: run.id, verdict: 'reserved' }]);
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
