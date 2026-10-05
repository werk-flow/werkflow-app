// The app layout and the upgrade page with the real cached readers and only
// the database replaced: an unknown subscription status is a failure with a
// retry (app/error.tsx), never "not subscribed" and never the paywall. A
// failed profile read degrades to the shell without the profile.
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
const stored = new Map<string, unknown>();
mock.module('next/cache', () => ({
  unstable_cache:
    <Arguments extends unknown[], Result>(read: (...args: Arguments) => Promise<Result>, keys: string[]) =>
    async (...args: Arguments): Promise<unknown> => {
      const key = JSON.stringify([keys, args]);
      if (stored.has(key)) return stored.get(key);
      const value = await read(...args);
      stored.set(key, value);
      return value;
    },
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
mock.module('@/lib/subscription/helpers', () => ({ userHasOrganizations: async () => false }));
mock.module('@/lib/time-tracking/actions', () => ({
  getCurrentClockState: () => new Promise(() => undefined),
  getActiveJobIdsForOrg: () => new Promise(() => undefined),
}));
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email: 'erika@example.invalid' } }, error: null }),
    },
  }),
}));
console.error = () => undefined;

const failing = new Set<string>();
function rowsFor(table: string): { single: unknown; many: unknown[] } {
  if (table === 'subscriptions') return { single: { status: 'active' }, many: [] };
  if (table === 'profiles') {
    return { single: { id: userId, first_name: 'Erika', last_name: 'Muster', avatar_path: null }, many: [] };
  }
  if (table === 'organization_members') {
    return {
      single: null,
      many: [
        {
          organization_id: organizationId,
          role: 'admin',
          joined_at: '2026-01-01T00:00:00Z',
          organizations: {
            id: organizationId,
            name: 'Muster SHK',
            unique_code: 'ABC123',
            employee_records: [],
          },
        },
      ],
    };
  }
  throw new Error(`Unexpected table ${table}`);
}
function tableQuery(table: string): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'limit']) query[method] = () => query;
  const failure = { data: null, error: { code: 'XX000', message: 'private' } };
  query.maybeSingle = async () =>
    failing.has(table) ? failure : { data: rowsFor(table).single, error: null };
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ): Promise<unknown> =>
    Promise.resolve(failing.has(table) ? failure : { data: rowsFor(table).many, error: null }).then(
      resolve,
      reject,
    );
  return query;
}
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => tableQuery(table) }),
}));

const { CachedReadError } = await import('@/lib/data/cached-read-failure');
const { default: AppLayout } = await import('@/app/(app)/layout');
const { default: UpgradePage } = await import('@/app/upgrade/page');

async function renderLayout(): Promise<ReactElement> {
  const root = AppLayout({ children: 'Authorized page content' });
  const providers = root.props.children as ReactElement<{ children: ReactNode }>;
  const render = providers.type as (props: { children: ReactNode }) => Promise<ReactElement>;
  return render(providers.props);
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

function isSubscriptionFailure(error: unknown): boolean {
  return error instanceof CachedReadError && error.code === 'subscription_read_failed';
}

// Unknown subscription status: the layout fails into the error page, it neither
// redirects nor renders a shell that claims "not subscribed".
failing.add('subscriptions');
failing.add('profiles');
await assert.rejects(renderLayout(), isSubscriptionFailure);
assert.deepEqual(redirects, []);

// The upgrade page does not offer the plan to a caller whose status is unknown.
await assert.rejects(UpgradePage(), isSubscriptionFailure);
assert.deepEqual(redirects, []);

// The failure was not cached: the next render reads again and succeeds.
failing.delete('subscriptions');
const rendered = await renderLayout();
assert.equal(propsOf(rendered, 'OrganizationProvider')?.initialIsSubscribed, true);
// A failed profile read degrades this request to the shell without the profile.
assert.equal(propsOf(rendered, 'UserProfileProvider')?.initialProfile, null);
assert.equal(propsOf(rendered, 'AppShell')?.children, 'Authorized page content');
failing.delete('profiles');

// A subscribed caller is sent on from the upgrade page, never shown the offer.
await assert.rejects(UpgradePage(), /redirect:\/onboarding\/create-organization/);
assert.deepEqual(redirects, ['/onboarding/create-organization']);
