// Shared setup for the Server Action boundary fixtures: the real actions run
// with only identity, cookies, cache invalidation, navigation and the database
// replaced. Each fixture is its own process, so these module mocks never reach
// another test file. Import the action under test only after `installActionWorld`.
import { mock } from 'bun:test';
import { createInMemoryAdmin, type BeforeWrite, type InMemoryTables } from './in-memory-admin';

type FixtureRole = 'admin' | 'buero' | 'employee';
type FixtureRow = Record<string, unknown>;
type FixtureError = { code?: string; message: string };
type RpcOutcome = { data: unknown; error: FixtureError | null };
type RpcCall = { name: string; args: FixtureRow };
type FunctionCall = { name: string; body: FixtureRow };
type InMemoryQuery = ReturnType<ReturnType<typeof createInMemoryAdmin>['from']>;

export const ORGANIZATION_A = '20000000-0000-4000-8000-00000000000a';
export const ORGANIZATION_B = '20000000-0000-4000-8000-00000000000b';
export const CALLER_ID = '30000000-0000-4000-8000-000000000001';

export type ActionWorld = {
  /** `null` is a signed-out caller. */
  callerId: string | null;
  /** The caller's current memberships as the membership read returns them. */
  memberships: Array<{ orgId: string; role: FixtureRole }>;
  /** Organizations where the caller is an employee whose access has not started yet. */
  prestartOrganizationIds: string[];
  /** Value of the active-organization cookie; `null` is a missing cookie. */
  activeOrganizationCookie: string | null;
  tables: InMemoryTables;
  rpc: (call: RpcCall) => RpcOutcome;
  rpcCalls: RpcCall[];
  invokeFunction: (call: FunctionCall) => { error: FixtureError | null };
  functionCalls: FunctionCall[];
  /** The Auth admin deletion of a user; it runs the database's cascades and guards. */
  deleteUser: (userId: string) => { error: FixtureError | null };
  deletedUserIds: string[];
  /** How often an action asked for the service-role client. */
  adminClientRequests: number;
  /** Tables whose every read answers with a connection error instead of rows. */
  failingTables: Set<string>;
  /**
   * Runs once, right before the next update or delete selects its rows, and is
   * then cleared: the concurrent change that lands between an action's read and its write.
   */
  beforeNextWrite: BeforeWrite | null;
};

export function signInAs(world: ActionWorld, role: FixtureRole | null, orgId: string = ORGANIZATION_A): void {
  world.callerId = CALLER_ID;
  world.memberships = role === null ? [] : [{ orgId, role }];
  world.prestartOrganizationIds = [];
  world.activeOrganizationCookie = role === null ? null : orgId;
}

export function tableRows(world: ActionWorld, table: string): FixtureRow[] {
  return world.tables[table] ?? [];
}

/** The service-role client: the world's tables, its database functions, edge functions and Auth admin. */
function createAdminStandIn(world: ActionWorld, database: () => { from: (table: string) => InMemoryQuery }) {
  world.adminClientRequests += 1;
  return {
    from: (table: string) => database().from(table),
    rpc: async (name: string, args: FixtureRow = {}) => {
      world.rpcCalls.push({ name, args });
      return world.rpc({ name, args });
    },
    functions: {
      invoke: async (name: string, options: { body: FixtureRow }) => {
        world.functionCalls.push({ name, body: options.body });
        return world.invokeFunction({ name, body: options.body });
      },
    },
    auth: {
      admin: {
        deleteUser: async (userId: string) => {
          world.deletedUserIds.push(userId);
          return world.deleteUser(userId);
        },
      },
    },
  };
}

export function installActionWorld(
  tables: InMemoryTables,
  columnDefaults: Record<string, () => FixtureRow> = {},
): ActionWorld {
  const world: ActionWorld = {
    callerId: CALLER_ID,
    memberships: [],
    prestartOrganizationIds: [],
    activeOrganizationCookie: null,
    tables,
    rpc: () => ({ data: null, error: null }),
    rpcCalls: [],
    invokeFunction: () => ({ error: null }),
    functionCalls: [],
    deleteUser: () => ({ error: null }),
    deletedUserIds: [],
    adminClientRequests: 0,
    failingTables: new Set(),
    beforeNextWrite: null,
  };
  const beforeWrite: BeforeWrite = (table) => {
    const interleave = world.beforeNextWrite;
    world.beforeNextWrite = null;
    interleave?.(table);
  };
  // Results are copies, as over the network: a later write must not change a row an action read earlier.
  const database = (): { from: (table: string) => InMemoryQuery } => ({
    from: (table) => {
      const query = createInMemoryAdmin(world.tables, columnDefaults, beforeWrite).from(table);
      const read = query.then.bind(query);
      query.then = (onFulfilled, onRejected) =>
        read((result) =>
          world.failingTables.has(table)
            ? { ...result, data: null, error: { code: '08006', message: 'connection failure' } }
            : { ...result, data: structuredClone(result.data) },
        ).then(onFulfilled, onRejected);
      return query;
    },
  });
  const unusedRead = (name: string) => (): never => {
    throw new Error(`${name} is outside this fixture`);
  };

  mock.module('server-only', () => ({}));
  mock.module('next/headers', () => ({
    cookies: async () => ({
      get: (name: string) =>
        name === 'current_org_id' && world.activeOrganizationCookie !== null
          ? { name, value: world.activeOrganizationCookie }
          : undefined,
    }),
    headers: async () => ({ get: () => null }),
  }));
  mock.module('next/cache', () => ({
    updateTag: () => {},
    revalidatePath: () => {},
    revalidateTag: () => {},
    cacheTag: () => {},
    cacheLife: () => {},
    unstable_cache: unusedRead('unstable_cache'),
  }));
  mock.module('next/navigation', () => ({
    redirect: (path: string): never => {
      throw new Error(`redirect:${path}`);
    },
  }));
  mock.module('@/lib/supabase/admin', () => ({
    createSupabaseAdminClient: () => createAdminStandIn(world, database),
  }));
  // The caller-scoped client reads the same rows; row-level security is SQL-tested.
  mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => database() }));
  const asMembership = (membership: { orgId: string; role: FixtureRole }) => ({
    ...membership,
    name: 'Fixture company',
    uniqueCode: 'ABCDEF',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });
  mock.module('@/lib/data/cached', () => ({
    // Any tag name resolves to a string; invalidation itself is replaced above.
    CACHE_TAGS: new Proxy({}, { get: (_target, tag) => () => String(tag) }),
    getAuthenticatedUser: async () =>
      world.callerId === null ? null : { id: world.callerId, email: 'caller@example.test' },
    getCachedMemberships: async () => world.memberships.map(asMembership),
    getCachedUser: unusedRead('getCachedUser'),
    getCachedPrestartMemberships: async () =>
      world.prestartOrganizationIds.map((orgId) => asMembership({ orgId, role: 'employee' })),
    getCachedMemberCount: unusedRead('getCachedMemberCount'),
    getCachedOrganizationSettings: unusedRead('getCachedOrganizationSettings'),
    getCachedOrganizationCalendar: unusedRead('getCachedOrganizationCalendar'),
    getCachedOrganizationUserPreferences: unusedRead('getCachedOrganizationUserPreferences'),
    getCachedUserProfile: unusedRead('getCachedUserProfile'),
  }));
  return world;
}
