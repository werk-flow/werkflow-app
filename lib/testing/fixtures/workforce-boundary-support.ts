// Shared stand-ins for the workforce boundary fixtures (personnel, vacation,
// time accounts, time corrections, work and planning actions). Each fixture
// still runs the real actions on `action-boundary-world.ts`.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, tableRows, type ActionWorld } from './action-boundary-world';

/** A database write function that loads its target row by id inside the organization it is given. */
export type ScopedFunction = {
  readonly table: string;
  readonly idArgument: string;
  readonly refusal: string;
};

/**
 * Stands in for write functions that lock their target inside `p_organization_id`:
 * a row of another organization is refused with the function's not-found code,
 * and the stand-in itself never changes a row.
 */
export function installScopedFunctions(
  world: ActionWorld,
  functions: Readonly<Record<string, ScopedFunction>>,
  success: unknown = '7f000000-0000-4000-8000-000000000001',
): void {
  world.rpc = ({ name, args }) => {
    const scope = functions[name];
    if (!scope) return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
    const target = tableRows(world, scope.table).find(
      (row) => row.id === args[scope.idArgument] && row.organization_id === args.p_organization_id,
    );
    return target
      ? { data: success, error: null }
      : { data: null, error: { code: 'P0001', message: scope.refusal } };
  };
}

/** The whole in-memory database, to prove a refused call wrote nothing. */
export function databaseSnapshot(world: ActionWorld): string {
  return JSON.stringify(world.tables);
}

/** Every database function call so far named the caller's organization and, where it takes one, the caller. */
export function assertCallerScopedCalls(world: ActionWorld): void {
  for (const call of world.rpcCalls) {
    assert.equal(call.args.p_organization_id, ORGANIZATION_A, `${call.name} named another organization`);
    if ('p_actor_id' in call.args)
      assert.equal(call.args.p_actor_id, CALLER_ID, `${call.name} named another actor`);
  }
}
