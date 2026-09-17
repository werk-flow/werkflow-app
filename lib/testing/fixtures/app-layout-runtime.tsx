import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

const organizationId = '10000000-0000-4000-8000-000000000001';
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
] as const) {
  const leaf = ({ children }: { children?: ReactNode }): ReactNode => children;
  leaves.set(exportName, leaf);
  mock.module(modulePath, () => ({ [exportName]: leaf }));
}
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('next/navigation', () => ({ redirect: () => { throw new Error('Unexpected redirect'); } }));
mock.module('@/lib/data/cached', () => ({
  getCachedUser: async () => ({ data: { user: { id: 'caller', email: 'synthetic@example.invalid' } } }),
  getCachedMemberships: async () => [{ orgId: organizationId, role: 'admin' }],
  getCachedSubscriptionStatus: async () => true,
  getCachedUserProfile: async () => ({}),
}));
mock.module('@/lib/org/cookies', () => ({ CURRENT_ORG_COOKIE: 'current_org_id', resolveActiveOrgId: async () => organizationId }));
mock.module('@/lib/auth/redirects', () => ({ getAuthenticatedRedirectPath: async () => '/login' }));
let optionalReads = 0;
const heldRead = (): Promise<never> => { optionalReads++; return new Promise(() => undefined); };
mock.module('@/lib/time-tracking/actions', () => ({ getCurrentClockState: heldRead, getActiveJobIdsForOrg: heldRead }));

const { default: AppLayout } = await import('@/app/(app)/layout');
const root = AppLayout({ children: 'Authorized page content' });
const providers = root.props.children as ReactElement<{ children: ReactNode }>;
assert.equal(typeof providers.type, 'function');
const render = providers.type as (props: { children: ReactNode }) => Promise<ReactElement>;
let rendered: ReactElement | undefined;
let failure: unknown;
void render(providers.props).then((result) => { rendered = result; }, (error: unknown) => { failure = error; });
// All required fixture reads resolve immediately; optional reads stay held forever.
for (let turn = 0; turn < 30; turn++) await Promise.resolve();
assert.equal(failure, undefined);
assert.equal(optionalReads, 0, 'Optional clock/job reads must not start in the route layout');
assert.ok(rendered, 'Authorized route content must be returned while optional reads are unavailable');
const propsByName = new Map<string, Record<string, unknown>>();
function visit(node: ReactNode): void {
  if (Array.isArray(node)) { node.forEach(visit); return; }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  for (const [name, component] of leaves) if (node.type === component) propsByName.set(name, node.props);
  visit(node.props.children as ReactNode);
}
visit(rendered);
const clockProviderProps = propsByName.get('ClockStateProvider');
const activeJobsProviderProps = propsByName.get('ActiveJobsProvider');
assert.ok(clockProviderProps && activeJobsProviderProps, 'Both optional providers must be rendered in the route layout');
assert.equal(clockProviderProps.initialState, undefined);
assert.equal(activeJobsProviderProps.initialActiveJobIds, undefined);
assert.equal(activeJobsProviderProps.initialOrganizationId, undefined);
assert.equal(propsByName.get('AppShell')?.children, 'Authorized page content');
