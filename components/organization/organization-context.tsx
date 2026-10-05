'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { logError } from '@/lib/logging';
import { setActiveOrgCookie } from '@/lib/org/actions';
import type { Database } from '@/lib/supabase/database.types';
import type { UserOrg } from '@/lib/org/types';

// Types
type OrgRole = Database['public']['Enums']['org_role'];

export type { UserOrg };

export type OrgContextValue = {
  memberships: UserOrg[];
  activeOrgId: string | null;
  activeOrg: UserOrg | null;
  setActiveOrg: (orgId: string) => Promise<void>;
  refreshMemberships: () => Promise<void>;
  isLoading: boolean;
  isSubscribed: boolean;
  isSwitchingOrg: boolean;
};

type MembershipRow = {
  organization_id: string;
  role: OrgRole;
  joined_at: string;
  organizations: { name: string; unique_code: string } | null;
};

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

// Context
const OrganizationContext = createContext<OrgContextValue | null>(null);

// Provider props
type OrganizationProviderProps = {
  children: ReactNode;
  initialMemberships: UserOrg[];
  initialActiveOrgId: string | null;
  initialActiveOrgCookieNeedsSync: boolean;
  initialIsSubscribed: boolean;
};

export function OrganizationProvider({
  children,
  initialMemberships,
  initialActiveOrgId,
  initialActiveOrgCookieNeedsSync,
  initialIsSubscribed,
}: OrganizationProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showBanner } = useBanner();
  const [, startTransition] = useTransition();
  const [memberships, setMemberships] = useState<UserOrg[]>(initialMemberships);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(initialActiveOrgId);
  const [isSubscribed, setIsSubscribed] = useState(initialIsSubscribed);
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false);
  const pendingOrgIdRef = useRef<string | null>(null);
  // Background membership reconciliation keeps the last-known sidebar in
  // place. Replacing it with a skeleton would unmount an open organization
  // picker; actual organization switches have their own explicit lock.
  const isLoading = false;

  // New server props (e.g. after router.refresh()) are adopted during render,
  // never in an effect (realtime-and-caching checklist).
  const [adoptedProps, setAdoptedProps] = useState({
    initialMemberships,
    initialActiveOrgId,
    initialIsSubscribed,
  });
  if (
    initialMemberships !== adoptedProps.initialMemberships ||
    initialActiveOrgId !== adoptedProps.initialActiveOrgId ||
    initialIsSubscribed !== adoptedProps.initialIsSubscribed
  ) {
    setAdoptedProps({ initialMemberships, initialActiveOrgId, initialIsSubscribed });
    if (initialMemberships !== adoptedProps.initialMemberships) setMemberships(initialMemberships);
    if (initialActiveOrgId !== adoptedProps.initialActiveOrgId) setActiveOrgId(initialActiveOrgId);
    if (initialIsSubscribed !== adoptedProps.initialIsSubscribed) setIsSubscribed(initialIsSubscribed);
  }

  // Proactively set the cookie when the active org is resolved from fallback
  // so that subsequent server-side renders can read it immediately.
  const hasSetCookieRef = useRef(false);
  useEffect(() => {
    if (initialActiveOrgCookieNeedsSync && initialActiveOrgId && !hasSetCookieRef.current) {
      hasSetCookieRef.current = true;
      setActiveOrgCookie(initialActiveOrgId).catch((error: unknown) => {
        logError('OrganizationProvider: active organization sync failed', error);
        showBanner({
          variant: 'error',
          message: 'Die aktive Organisation konnte nicht synchronisiert werden.',
        });
      });
    }
  }, [initialActiveOrgCookieNeedsSync, initialActiveOrgId, showBanner]);

  const activeOrg = memberships.find((m) => m.orgId === activeOrgId) ?? null;

  // Overlapping refreshes must not interleave: only the newest call commits.
  const refreshGenerationRef = useRef(0);
  const refreshMemberships = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (generation !== refreshGenerationRef.current) return;

      if (!user) {
        setMemberships([]);
        setActiveOrgId(null);
        return;
      }

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
        .eq('user_id', user.id);

      if (generation !== refreshGenerationRef.current) return;

      if (error) {
        logError('OrganizationProvider: membership read failed', error);
        showBanner({
          variant: 'error',
          message: 'Die Organisationsdaten konnten nicht aktualisiert werden.',
        });
        return;
      }

      // The browser client is untyped; the row shape follows the select above.
      const newMemberships: UserOrg[] = (data ?? []).flatMap((m: MembershipRow) => {
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

      setMemberships(newMemberships);

      if (activeOrgId && !newMemberships.some((m) => m.orgId === activeOrgId)) {
        // A selection the user makes meanwhile invalidates this fallback (see setActiveOrg).
        if (generation !== refreshGenerationRef.current) return;
        const newActiveId = newMemberships[0]?.orgId ?? null;
        if (newActiveId) {
          await setActiveOrgCookie(newActiveId);
        }
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
  }, [activeOrgId, showBanner]);

  const setActiveOrg = useCallback(
    async (orgId: string) => {
      if (orgId === activeOrgId || pendingOrgIdRef.current) {
        return;
      }

      pendingOrgIdRef.current = orgId;
      setIsSwitchingOrg(true);
      // An in-flight membership refresh must not fall back over this selection.
      refreshGenerationRef.current += 1;

      try {
        await setActiveOrgCookie(orgId);
        // GET readers authorize against this cookie. Publish the new scope only
        // after its response commits, otherwise their first read is denied.
        setActiveOrgId(orgId);

        const parentPath = getParentListPath(pathname);

        // Wrap navigation in startTransition so React keeps showing the
        // current UI (with the overlay) until the server finishes rendering
        // the new org data. This prevents the hydration mismatch that occurs
        // when PPR serves a stale static shell while dynamic data is still
        // streaming for the new org.
        startTransition(() => {
          if (parentPath) {
            router.push(parentPath);
          } else {
            router.refresh();
          }
        });
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
    },
    [activeOrgId, router, pathname, showBanner, startTransition],
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
      isSubscribed,
      isSwitchingOrg,
    }),
    [
      memberships,
      activeOrgId,
      activeOrg,
      setActiveOrg,
      refreshMemberships,
      isLoading,
      isSubscribed,
      isSwitchingOrg,
    ],
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
      isSubscribed: false,
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
