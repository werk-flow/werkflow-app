'use client';

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { endSessionAfterCheck, withReload } from '@/components/shared/unsent-work-gate';
import { clearTodayOnDevice } from '@/lib/field-sync/device/today-wipe';
import { clearServiceWorkerCaches, restoreOfflineShell } from '@/lib/offline/service-worker-caches';
import { setActiveOrgCookie } from '@/lib/org/actions';
import type { UserOrg } from '@/lib/org/types';
import type { OrgRole } from '@/lib/roles';

export type { UserOrg };

export type OrgContextValue = {
  memberships: UserOrg[];
  activeOrgId: string | null;
  activeOrg: UserOrg | null;
  setActiveOrg: (orgId: string) => Promise<void>;
  refreshMemberships: () => Promise<void>;
  isLoading: boolean;
  isSwitchingOrg: boolean;
};

/** A refused cookie write rejects, so it takes the same failure path as a transport error. */
function rejectRefusal(result: ActionResult): void {
  if (!result.success) throw new Error(result.error);
}

/**
 * Waits for the active organization cookie to change, then deletes every cache the service
 * worker owns, so nothing the previous organization's views cached stays on the device, and
 * only then asks for the offline shell again: the switch navigates on the client, which never
 * refills it, and the cookie action's response can render the new organization before the
 * clear has finished.
 */
async function clearCachesAfterSwitch(cookieChange: Promise<ActionResult>): Promise<void> {
  rejectRefusal(await cookieChange);
  await clearServiceWorkerCaches();
  await restoreOfflineShell();
}

type MembershipRow = {
  organization_id: string;
  role: OrgRole;
  joined_at: string;
  organizations: { name: string; unique_code: string } | null;
};

type MembershipRead =
  | { kind: 'failed'; label: string; error: unknown }
  | { kind: 'signed-out' }
  | { kind: 'rows'; rows: MembershipRow[] };

/**
 * The caller's memberships through the browser client. The stored session
 * names the user without an Auth round trip; it is no authority, because
 * row-level security checks the token on the membership read. A session read
 * that could not complete (a failed token refresh) is a failure, never a
 * sign-out.
 */
async function readOwnMemberships(): Promise<MembershipRead> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError)
    return { kind: 'failed', label: 'OrganizationProvider: session read failed', error: sessionError };
  if (!session) return { kind: 'signed-out' };
  const { data, error } = await supabase
    .from('organization_members')
    .select(
      `
      organization_id,
      role,
      joined_at,
      organizations (
        id,
        name,
        unique_code
      )
    `,
    )
    .eq('user_id', session.user.id);
  if (error) return { kind: 'failed', label: 'OrganizationProvider: membership read failed', error };
  // The browser client is untyped; the row shape follows the select above.
  const rows: MembershipRow[] = data ?? [];
  return { kind: 'rows', rows };
}

/** The memberships whose organization row is readable, in the shape of the context. */
function toUserOrgs(rows: MembershipRow[]): UserOrg[] {
  return rows.flatMap((m) => {
    const org = m.organizations;
    return org
      ? [
          {
            orgId: m.organization_id,
            name: org.name,
            uniqueCode: org.unique_code,
            role: m.role,
            joinedAt: m.joined_at,
          },
        ]
      : [];
  });
}

/** Reloads the memberships; a call commits only while `refreshGenerationRef` still holds its generation. */
async function refreshOwnMemberships({
  refreshGenerationRef,
  activeOrgId,
  showBanner,
  setMemberships,
  setActiveOrgId,
}: {
  refreshGenerationRef: RefObject<number>;
  activeOrgId: string | null;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setMemberships: (memberships: UserOrg[]) => void;
  setActiveOrgId: (orgId: string | null) => void;
}): Promise<void> {
  const generation = ++refreshGenerationRef.current;
  try {
    const read = await readOwnMemberships();
    if (generation !== refreshGenerationRef.current) return;

    if (read.kind === 'failed') {
      logError(read.label, read.error);
      showBanner({
        variant: 'error',
        message: 'Die Organisationsdaten konnten nicht aktualisiert werden.',
      });
      return;
    }
    if (read.kind === 'signed-out') {
      setMemberships([]);
      setActiveOrgId(null);
      return;
    }

    const newMemberships = toUserOrgs(read.rows);

    setMemberships(newMemberships);

    if (activeOrgId && !newMemberships.some((m) => m.orgId === activeOrgId)) {
      const newActiveId = newMemberships[0]?.orgId ?? null;
      // Nothing the former organization's day held stays, even when no organization remains. Before
      // the cookie: the next start page's refresh must come after this wipe, never before it.
      await clearTodayOnDevice();
      // A selection the user made meanwhile (see setActiveOrg) owns the cookie; this fallback must not write over it.
      if (newActiveId && generation === refreshGenerationRef.current)
        await setActiveOrgCookie(newActiveId).then(rejectRefusal);
      if (generation !== refreshGenerationRef.current) return;
      setActiveOrgId(newActiveId);
    }
  } catch (error) {
    if (generation !== refreshGenerationRef.current) return;
    logError('OrganizationProvider: membership refresh failed', error);
    showBanner({
      variant: 'error',
      message: 'Die Organisationsdaten konnten nicht aktualisiert werden.',
    });
  }
}

/**
 * Claims the switch for `orgId`, then settles the phone's unsent work: it belongs to the
 * organization the person leaves, and the server refuses it under another one. So it is sent, or
 * the person decides, before `proceed` starts the switch. When the person stays, the claim is
 * dropped, and the membership refresh this selection discarded runs again.
 */
async function switchAfterCheck(
  orgId: string,
  pendingOrgIdRef: RefObject<string | null>,
  showBanner: ReturnType<typeof useBanner>['showBanner'],
  refreshMemberships: () => Promise<void>,
  proceed: () => Promise<void>,
): Promise<void> {
  pendingOrgIdRef.current = orgId;
  if (await endSessionAfterCheck(withReload(showBanner), proceed, 'organization')) return;
  pendingOrgIdRef.current = null;
  void refreshMemberships();
}

function getParentListPath(pathname: string): string | null {
  const detailRoutePatterns = [
    { pattern: /^\/auftraege\/[^/]+$/, parent: '/auftraege' },
    { pattern: /^\/auftraege\/projekt\/[^/]+$/, parent: '/auftraege' },
    { pattern: /^\/auftraege\/projekt\/[^/]+\/[^/]+$/, parent: '/auftraege' },
    { pattern: /^\/mitarbeiter\/[^/]+$/, parent: '/mitarbeiter' },
    { pattern: /^\/kunden\/[^/]+$/, parent: '/kunden' },
  ];

  for (const { pattern, parent } of detailRoutePatterns) {
    if (pattern.test(pathname)) {
      return parent;
    }
  }

  return null;
}

/** Adopts new server props into the provider's state; the setters are the provider's own. */
function useAdoptedServerProps({
  initialMemberships,
  initialActiveOrgId,
  setMemberships,
  setActiveOrgId,
}: {
  initialMemberships: UserOrg[];
  initialActiveOrgId: string | null;
  setMemberships: (memberships: UserOrg[]) => void;
  setActiveOrgId: (orgId: string | null) => void;
}): void {
  // New server props (e.g. after router.refresh()) are adopted during render,
  // never in an effect (realtime-and-caching checklist).
  const [adoptedProps, setAdoptedProps] = useState({
    initialMemberships,
    initialActiveOrgId,
  });
  if (
    initialMemberships !== adoptedProps.initialMemberships ||
    initialActiveOrgId !== adoptedProps.initialActiveOrgId
  ) {
    setAdoptedProps({ initialMemberships, initialActiveOrgId });
    if (initialMemberships !== adoptedProps.initialMemberships) setMemberships(initialMemberships);
    if (initialActiveOrgId !== adoptedProps.initialActiveOrgId) setActiveOrgId(initialActiveOrgId);
  }
}

/** Writes the organization the server resolved from a fallback into the cookie, once per mount. */
function useFallbackOrgCookieSync({
  initialActiveOrgCookieNeedsSync,
  initialActiveOrgId,
  showBanner,
}: {
  initialActiveOrgCookieNeedsSync: boolean;
  initialActiveOrgId: string | null;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
}): void {
  // Proactively set the cookie when the active org is resolved from fallback
  // so that subsequent server-side renders can read it immediately.
  const hasSetCookieRef = useRef(false);
  useEffect(() => {
    if (initialActiveOrgCookieNeedsSync && initialActiveOrgId && !hasSetCookieRef.current) {
      hasSetCookieRef.current = true;
      setActiveOrgCookie(initialActiveOrgId)
        .then(rejectRefusal)
        .catch((error: unknown) => {
          logError('OrganizationProvider: active organization sync failed', error);
          showBanner({
            variant: 'error',
            message: 'Die aktive Organisation konnte nicht synchronisiert werden.',
          });
        });
    }
  }, [initialActiveOrgCookieNeedsSync, initialActiveOrgId, showBanner]);
}

// Context
const OrganizationContext = createContext<OrgContextValue | null>(null);

// Provider props
type OrganizationProviderProps = {
  children: ReactNode;
  initialMemberships: UserOrg[];
  initialActiveOrgId: string | null;
  initialActiveOrgCookieNeedsSync: boolean;
};

export function OrganizationProvider({
  children,
  initialMemberships,
  initialActiveOrgId,
  initialActiveOrgCookieNeedsSync,
}: OrganizationProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showBanner } = useBanner();
  const [memberships, setMemberships] = useState<UserOrg[]>(initialMemberships);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(initialActiveOrgId);
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false);
  const pendingOrgIdRef = useRef<string | null>(null);
  // Background membership reconciliation keeps the last-known sidebar in
  // place. Replacing it with a skeleton would unmount an open organization
  // picker; actual organization switches have their own explicit lock.
  const isLoading = false;

  useAdoptedServerProps({ initialMemberships, initialActiveOrgId, setMemberships, setActiveOrgId });

  useFallbackOrgCookieSync({ initialActiveOrgCookieNeedsSync, initialActiveOrgId, showBanner });

  const activeOrg = memberships.find((m) => m.orgId === activeOrgId) ?? null;

  // Overlapping refreshes must not interleave: only the newest call commits.
  const refreshGenerationRef = useRef(0);
  const refreshMemberships = useCallback(
    () =>
      refreshOwnMemberships({
        refreshGenerationRef,
        activeOrgId,
        showBanner,
        setMemberships,
        setActiveOrgId,
      }),
    [activeOrgId, showBanner],
  );

  const setActiveOrg = useCallback(
    async (orgId: string) => {
      if (orgId === activeOrgId || pendingOrgIdRef.current) return;

      // An in-flight membership refresh must not fall back over this selection.
      refreshGenerationRef.current += 1;
      await switchAfterCheck(orgId, pendingOrgIdRef, showBanner, refreshMemberships, async () => {
        setIsSwitchingOrg(true);

        try {
          // Nothing the previous organization's day held stays on the device. Before the cookie: the
          // new organization's start page can render from the cookie action's response, and its
          // refresh must come after this wipe, never before it.
          await clearTodayOnDevice();
          // The cookie call stays in this handler, where the double-render check sees it.
          await clearCachesAfterSwitch(setActiveOrgCookie(orgId));
          // GET readers authorize against this cookie. Publish the new scope only
          // after its response commits, otherwise their first read is denied.
          setActiveOrgId(orgId);

          const parentPath = getParentListPath(pathname);

          // Wrap navigation in startTransition so React keeps showing the
          // current UI (with the overlay) until the server finishes rendering
          // the new org data. This prevents the hydration mismatch that occurs
          // when PPR serves a stale static shell while dynamic data is still
          // streaming for the new org. The overlay's pending state is
          // isSwitchingOrg, never the transition's.
          startTransition(() => (parentPath ? router.push(parentPath) : router.refresh()));
        } catch (error) {
          logError('OrganizationProvider: organization switch failed', error);
          setActiveOrgId(activeOrgId);
          pendingOrgIdRef.current = null;
          setIsSwitchingOrg(false);
          showBanner({
            variant: 'error',
            message: 'Die Organisation konnte nicht gewechselt werden.',
          });
        }
      });
    },
    [activeOrgId, router, pathname, showBanner, refreshMemberships],
  );

  // Reset switching state when server data arrives for the target org
  useEffect(() => {
    if (pendingOrgIdRef.current && initialActiveOrgId === pendingOrgIdRef.current) {
      pendingOrgIdRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the switch target lives in a ref the switch handler writes, and a ref cannot be read during render
      setIsSwitchingOrg(false);
    }
  }, [initialActiveOrgId]);

  // Membership freshness (member added/removed/role changed, tab return) is
  // handled by OrganizationRealtimeBridge, mounted below the Realtime
  // provider — this provider sits above it and cannot subscribe itself.

  const value = useMemo<OrgContextValue>(
    () => ({
      memberships,
      activeOrgId,
      activeOrg,
      setActiveOrg,
      refreshMemberships,
      isLoading,
      isSwitchingOrg,
    }),
    [memberships, activeOrgId, activeOrg, setActiveOrg, refreshMemberships, isLoading, isSwitchingOrg],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

const noOrganizationSwitch = async (): Promise<void> => {};

/**
 * The scope of a person who waits for a join request and is no member yet.
 * A Realtime provider below it joins the requested organization's channel,
 * where row-level security delivers only the person's own join request. The
 * scope holds no membership, so nothing below can switch or read as a member.
 */
export function RequestedOrganizationScope({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const value = useMemo<OrgContextValue>(
    () => ({
      memberships: [],
      activeOrgId: organizationId,
      activeOrg: null,
      setActiveOrg: noOrganizationSwitch,
      refreshMemberships: noOrganizationSwitch,
      isLoading: false,
      isSwitchingOrg: false,
    }),
    [organizationId],
  );
  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

// Hook
export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}
