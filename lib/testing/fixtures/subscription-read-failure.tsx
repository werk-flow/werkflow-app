// The upgrade page with the real identity reader and subscription helpers and
// only the database replaced. The page reads the subscription per request: an
// unknown status is a failure with a retry (app/error.tsx), never "not
// subscribed" and never the offer, and a failure is not remembered. The app
// layout reads no subscription at all.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';

const leaves = new Map<string, (props: { children?: ReactNode }) => ReactNode>();
for (const [modulePath, exportName] of [
  ['@/components/organization/organization-context', 'OrganizationProvider'],
  ['@/components/organization/organization-realtime-bridge', 'OrganizationRealtimeBridge'],
  ['@/components/user/user-profile-context', 'UserProfileProvider'],
  ['@/components/realtime/realtime-provider', 'RealtimeProvider'],
  ['@/components/ui/banner', 'BannerProvider'],
  ['@/components/ui/open-dialog-context', 'OpenDialogProvider'],
  ['@/components/sidebar/app-shell', 'AppShell'],
  ['@/components/clock-fab', 'ClockFAB'],
  ['@/components/active-jobs-provider', 'ActiveJobsProvider'],
  ['@/components/clock-state-provider', 'ClockStateProvider'],
  ['@/components/sidebar/app-shell-skeleton', 'AppShellSkeleton'],
  ['@/app/upgrade/simulate-payment-button', 'SimulatePaymentButton'],
] as const) {
  const leaf = ({ children }: { children?: ReactNode }): ReactNode => children;
  leaves.set(exportName, leaf);
  mock.module(modulePath, () => ({ [exportName]: leaf }));
}

const redirects: string[] = [];
mock.module('next/navigation', () => ({
  redirect: (path: string) => {
    redirects.push(path);
    throw new Error(`redirect:${path}`);
  },
}));
mock.module('next/cache', () => ({
  unstable_cache:
    <Arguments extends unknown[], Result>(read: (...args: Arguments) => Promise<Result>) =>
    (...args: Arguments): Promise<Result> =>
      read(...args),
}));
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('@/lib/profile-avatar', () => ({ getProfileAvatarUrl: () => null }));
mock.module('@/lib/org/cookies', () => ({
  CURRENT_ORG_COOKIE: 'current_org_id',
  resolveActiveOrgId: async () => organizationId,
}));
mock.module('@/lib/auth/redirects', () => ({
  getAuthenticatedRedirectPath: async () => '/onboarding/start',
}));
mock.module('@/lib/time-tracking/actions', () => ({
  getCurrentClockState: () => new Promise(() => undefined),
  getActiveJobIdsForOrg: () => new Promise(() => undefined),
}));
console.error = () => undefined;

// One database. The caller's own reads go through the server client: the
// subscription row and the membership count. The layout's shell reads go
// through the admin client. Every table read is counted.
const failing = new Set<string>();
const reads = new Map<string, number>();
let subscriptionStatus: string | null = 'active';
const failure = { code: 'XX000', message: 'private' };
const membershipRows = [
  {
    organization_id: organizationId,
    role: 'admin',
    joined_at: '2026-01-01T00:00:00Z',
    organizations: { id: organizationId, name: 'Muster SHK', unique_code: 'ABC123', employee_records: [] },
  },
];

function answer(table: string, shape: 'single' | 'many'): Promise<Record<string, unknown>> {
  reads.set(table, (reads.get(table) ?? 0) + 1);
  if (failing.has(table)) return Promise.resolve({ data: null, error: failure, count: null });
  if (table === 'subscriptions') {
    return Promise.resolve(
      subscriptionStatus === null
        ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
        : { data: { user_id: userId, status: subscriptionStatus }, error: null },
    );
  }
  if (table === 'profiles') {
    return Promise.resolve({
      data: { id: userId, first_name: 'Erika', last_name: 'Muster', avatar_path: null },
      error: null,
    });
  }
  if (table === 'organization_members') {
    // The upgrade page counts the caller's memberships (none); the layout lists them.
    return Promise.resolve(
      shape === 'single' ? { data: null, error: null } : { data: membershipRows, error: null, count: 0 },
    );
  }
  throw new Error(`Unexpected table ${table}`);
}

function tableQuery(table: string): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'limit']) query[method] = () => query;
  query.maybeSingle = () => answer(table, 'single');
  query.single = () => answer(table, 'single');
  query.then = (
    resolve: (value: Record<string, unknown>) => unknown,
    reject: (reason: unknown) => unknown,
  ): Promise<unknown> => answer(table, 'many').then(resolve, reject);
  return query;
}
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email: 'erika@example.invalid' } }, error: null }),
    },
    from: (table: string) => tableQuery(table),
  }),
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => tableQuery(table) }),
}));

const { default: AppLayout } = await import('@/app/(app)/layout');
const { default: UpgradePage } = await import('@/app/upgrade/page');

function isSubscriptionFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'SubscriptionReadError' &&
    error.message === 'subscription_read_failed'
  );
}

function propsOf(node: ReactNode, name: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsOf(child, name);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === leaves.get(name)) return node.props;
  return propsOf(node.props.children as ReactNode, name);
}

// Unknown subscription status: the upgrade page fails into the error page. It
// neither redirects nor offers the plan to a caller who may already pay.
failing.add('subscriptions');
await assert.rejects(UpgradePage(), isSubscriptionFailure);
assert.deepEqual(redirects, []);

// The app layout renders the shell without reading the subscription.
const root = AppLayout({ children: 'Authorized page content' });
const providers = root.props.children as ReactElement<{ children: ReactNode }>;
const renderProviders = providers.type as (props: { children: ReactNode }) => Promise<ReactElement>;
const shell = await renderProviders(providers.props);
assert.equal(propsOf(shell, 'AppShell')?.children, 'Authorized page content');
assert.equal(reads.get('subscriptions'), 1, 'only the upgrade page read the subscription');
assert.deepEqual(redirects, []);

// The failure is not remembered: the next request reads again and sends the
// subscribed caller on to organization creation, never to the offer.
failing.delete('subscriptions');
await assert.rejects(UpgradePage(), /redirect:\/onboarding\/create-organization/);
assert.equal(reads.get('subscriptions'), 2, 'the read after a failure goes to the database again');
assert.deepEqual(redirects, ['/onboarding/create-organization']);

// A status read per request: a canceled subscription shows the offer on the next request.
subscriptionStatus = 'canceled';
assert.ok(isValidElement(await UpgradePage()), 'a caller without an active subscription sees the offer');
assert.equal(reads.get('subscriptions'), 3);
assert.deepEqual(redirects, ['/onboarding/create-organization']);
