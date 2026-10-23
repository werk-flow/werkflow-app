// Shared assertions of the operations boundary fixtures (qualifications,
// dispatch, customers, equipment, service cases, sickness, responsibilities,
// organization settings, calendar, documents and inventory): a refused action
// answers its exact failure and leaves the in-memory database as it was.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, type ActionWorld } from './action-boundary-world';

type ActionCall = readonly [name: string, call: () => Promise<unknown>];

/**
 * How far a refused call may reach: `none` refuses before the service-role
 * client exists, `reads` may read but never writes, `one-call` is refused by
 * the one database function it calls.
 */
type Reach = 'none' | 'reads' | 'one-call';

/** Calls each action and asserts the exact refusal and the reach it had. */
export async function assertRefused(
  world: ActionWorld,
  calls: readonly ActionCall[],
  expected: Record<string, unknown>,
  reach: Reach,
): Promise<void> {
  for (const [name, call] of calls) {
    const before = JSON.stringify(world.tables);
    world.adminClientRequests = 0;
    world.rpcCalls.length = 0;
    world.functionCalls.length = 0;
    assert.deepEqual(await call(), expected, `${name}: the refusal changed`);
    assert.equal(JSON.stringify(world.tables), before, `${name}: a refused call changed rows`);
    assert.equal(world.functionCalls.length, 0, `${name}: a refused call invoked a function`);
    if (reach === 'none') assert.equal(world.adminClientRequests, 0, `${name}: reached the database`);
    const expectedCalls = reach === 'one-call' ? 1 : 0;
    assert.equal(world.rpcCalls.length, expectedCalls, `${name}: made ${world.rpcCalls.length} calls`);
  }
}

/**
 * A database function stand-in that refuses a call naming another
 * organization or another actor, and refuses each listed foreign id with the
 * code the real function raises for it. Every other call succeeds with `data`.
 */
export function refuseForeignIds(
  world: ActionWorld,
  foreignIds: ReadonlyMap<string, string>,
  data: unknown = null,
): void {
  world.rpc = ({ args }) => {
    const actor = args.p_actor_id ?? args.p_user_id ?? CALLER_ID;
    if (args.p_organization_id !== ORGANIZATION_A || actor !== CALLER_ID)
      return { data: null, error: { code: 'P0001', message: 'not_authorized' } };
    for (const value of textValues(args)) {
      const refusal = foreignIds.get(value);
      if (refusal !== undefined) return { data: null, error: { code: 'P0001', message: refusal } };
    }
    return { data, error: null };
  };
}

/** Every text value of an argument, nested payloads included. */
function textValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(textValues);
  return [];
}
