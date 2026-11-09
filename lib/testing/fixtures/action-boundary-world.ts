// Shared setup for the Server Action boundary fixtures: the real actions run
// with only identity, cookies, cache invalidation, navigation and the database
// replaced. Each fixture is its own process, so these module mocks never reach
// another test file. Import the action under test only after `installActionWorld`.
import { mock } from 'bun:test';
import { AuthApiError } from '@supabase/supabase-js';
import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { getAuftraegePreferencesFromJson } from '@/lib/jobs/auftraege-table-columns';
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
  /** Bearer access tokens Auth accepts, each naming its user; any other token is rejected. */
  accessTokens: Record<string, string>;
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
      // A read function answers from the tables like a table read and is no recorded call.
      if (name === 'read_open_absences') return readOpenAbsencesInWorld(world, args);
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
      getUser: async (token: string) => {
        const userId = world.accessTokens[token];
        return userId === undefined
          ? { data: { user: null }, error: new AuthApiError('invalid JWT', 401, 'bad_jwt') }
          : { data: { user: { id: userId, email: 'caller@example.test' } }, error: null };
      },
      admin: {
        deleteUser: async (userId: string) => {
          world.deletedUserIds.push(userId);
          return world.deleteUser(userId);
        },
      },
    },
  };
}

/** The columns of a vacation request a fixture leaves out, as the table defaults them. */
const VACATION_ROW_DEFAULTS = {
  approved_days_by_year: null,
  cancellation_reason: null,
  cancelled_at: null,
  cancelled_by: null,
  comment: null,
  created_at: '2026-01-01T00:00:00.000Z',
  day_portion: 'full',
  decided_at: null,
  decided_by: null,
  decision_comment: null,
  requested_by: null,
  updated_at: '2026-01-01T00:00:00.000Z',
};

/**
 * The database function `read_open_absences`, answered from the world's tables:
 * the open vacation requests by start date, and each person who left with a
 * scheduled visit after the exit that has not started, from the day after the
 * exit. `supabase/tests/job_plan_bridge.sql` proves the function itself.
 */
function readOpenAbsencesInWorld(world: ActionWorld, args: FixtureRow): RpcOutcome {
  if (world.failingTables.has('vacation_requests')) {
    return { data: null, error: { code: '08006', message: 'connection failure' } };
  }
  const organizationId = args.p_organization_id;
  const today = String(args.p_today);
  const inOrganization = (table: string) =>
    tableRows(world, table).filter((row) => row.organization_id === organizationId);
  // The function returns whole rows; a fixture row names only the columns its test needs.
  const vacations = inOrganization('vacation_requests')
    .filter((row) => row.status === 'pending' || (row.status === 'approved' && String(row.end_date) >= today))
    .map((row): FixtureRow => ({ ...VACATION_ROW_DEFAULTS, ...row }))
    .toSorted((left, right) =>
      `${String(left.start_date)} ${String(left.id)}`.localeCompare(
        `${String(right.start_date)} ${String(right.id)}`,
      ),
    );
  const occurrences = new Map(inOrganization('planning_occurrences').map((row) => [row.id, row]));
  const startDateOf = (occurrence: FixtureRow) =>
    typeof occurrence.start_at === 'string'
      ? formatBerlinLocalDate(occurrence.start_at)
      : String(occurrence.start_date);
  const hasStarted = (occurrence: FixtureRow) =>
    typeof occurrence.start_at === 'string'
      ? Date.parse(occurrence.start_at) <= Date.now()
      : String(occurrence.start_date) <= today;
  const leaverWindows = inOrganization('employee_records').flatMap((record) => {
    const exitDate = record.exit_date;
    if (typeof exitDate !== 'string') return [];
    const holdsLaterVisit = inOrganization('planning_occurrence_assignments').some((assignment) => {
      const occurrence = occurrences.get(assignment.occurrence_id);
      return (
        assignment.employee_record_id === record.id &&
        occurrence?.status === 'scheduled' &&
        !hasStarted(occurrence) &&
        startDateOf(occurrence) > exitDate
      );
    });
    const from = addLocalDays(exitDate, 1);
    return holdsLaterVisit ? [{ employeeRecordId: record.id, from: from > today ? from : today }] : [];
  });
  return { data: structuredClone({ vacations, leaverWindows }), error: null };
}

/** A read the fixtures never reach; calling it fails the fixture. */
function unusedRead(name: string) {
  return (): never => {
    throw new Error(`${name} is outside this fixture`);
  };
}

/** The cached identity and organization reads, answered from the world. */
function mockCachedReads(world: ActionWorld): void {
  const asMembership = (membership: { orgId: string; role: FixtureRole }) => ({
    ...membership,
    name: 'Fixture company',
    uniqueCode: 'ABCDEF',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });
  const caller = () =>
    world.callerId === null ? null : { id: world.callerId, email: 'caller@example.test' };
  mock.module('@/lib/data/cached', () => ({
    // Any tag name resolves to a string; `installActionWorld` replaces invalidation itself.
    CACHE_TAGS: new Proxy({}, { get: (_target, tag) => () => String(tag) }),
    getAuthenticatedUser: async () => caller(),
    getCachedMemberships: async () => world.memberships.map(asMembership),
    getCachedUser: async () => ({ data: { user: caller() } }),
    getCachedPrestartMemberships: async () =>
      world.prestartOrganizationIds.map((orgId) => asMembership({ orgId, role: 'employee' })),
    getCachedMemberCount: unusedRead('getCachedMemberCount'),
    getCachedOrganizationSettings: unusedRead('getCachedOrganizationSettings'),
    getCachedOrganizationCalendar: unusedRead('getCachedOrganizationCalendar'),
    getCachedOrganizationUserPreferences: unusedRead('getCachedOrganizationUserPreferences'),
    // A page reads the caller's column choice; the defaults stand in.
    getOrganizationUserPreferencesForView: async () => ({
      visibleColumns: getAuftraegePreferencesFromJson(null),
      preferences: null,
    }),
    getCachedUserProfile: unusedRead('getCachedUserProfile'),
  }));
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
    accessTokens: {},
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
  mockCachedReads(world);
  return world;
}

/**
 * The database function `list_profile_references`, answered from the world's tables:
 * each named profile and whether that person is a member of the organization asked
 * about. `supabase/tests/organization_member_reads.sql` proves the function itself.
 */
export function listProfileReferencesInWorld(world: ActionWorld, args: FixtureRow): RpcOutcome {
  const userIds = args.p_user_ids;
  if (!Array.isArray(userIds)) throw new Error('list_profile_references needs p_user_ids');
  const members = tableRows(world, 'organization_members').filter(
    (member) => member.organization_id === args.p_organization_id,
  );
  return {
    data: tableRows(world, 'profiles')
      .filter((profile) => userIds.includes(profile.id))
      .map((profile) => ({ ...profile, is_member: members.some((member) => member.user_id === profile.id) })),
    error: null,
  };
}
