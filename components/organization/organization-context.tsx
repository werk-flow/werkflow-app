'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { setActiveOrgCookie, getActiveOrgCookie } from '@/lib/org/actions'
import type { Database } from '@/lib/supabase/database.types'

// Types
export type OrgRole = Database['public']['Enums']['org_role']

export type UserOrg = {
  orgId: string
  name: string
  uniqueCode: string
  role: OrgRole
  joinedAt: string
}

export type OrgContextValue = {
  memberships: UserOrg[]
  activeOrgId: string | null
  activeOrg: UserOrg | null
  setActiveOrg: (orgId: string) => Promise<void>
  refreshMemberships: () => Promise<void>
  isLoading: boolean
  isSubscribed: boolean
  isSwitchingOrg: boolean
}

type OrganizationData = {
  id: string
  name: string
  unique_code: string
}

/**
 * Maps detail page paths back to their parent list page.
 * Returns the list path if the current pathname is a detail sub-route,
 * or null if it's already a top-level page (safe to just refresh).
 */
function getParentListPath(pathname: string): string | null {
  const detailPrefixes = [
    { prefix: '/auftraege/', parent: '/auftraege' },
    { prefix: '/mitarbeiter/', parent: '/mitarbeiter' },
    { prefix: '/kunden/', parent: '/kunden' },
  ]

  for (const { prefix, parent } of detailPrefixes) {
    if (pathname.startsWith(prefix) && pathname !== parent) {
      return parent
    }
  }

  return null
}

// Context
const OrganizationContext = createContext<OrgContextValue | null>(null)

// Provider props
type OrganizationProviderProps = {
  children: ReactNode
  initialMemberships?: UserOrg[]
  initialActiveOrgId?: string | null
  initialIsSubscribed?: boolean
}

export function OrganizationProvider({
  children,
  initialMemberships = [],
  initialActiveOrgId = null,
  initialIsSubscribed = false,
}: OrganizationProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [memberships, setMemberships] = useState<UserOrg[]>(initialMemberships)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(initialActiveOrgId)
  const [isLoading, setIsLoading] = useState(
    initialMemberships.length === 0 && initialActiveOrgId === null
  )
  const [isSubscribed, setIsSubscribed] = useState(initialIsSubscribed)
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false)
  const pendingOrgIdRef = useRef<string | null>(null)
  const hydratedRef = useRef(false)

  // Sync state when server-provided props change (only when actually provided)
  useEffect(() => {
    if (initialMemberships.length > 0) {
      setMemberships(initialMemberships)
    }
  }, [initialMemberships])

  useEffect(() => {
    if (initialActiveOrgId !== null) {
      setActiveOrgId(initialActiveOrgId)
    }
  }, [initialActiveOrgId])

  // Proactively set the cookie when the active org is resolved from fallback
  const hasSetCookieRef = useRef(false)
  useEffect(() => {
    if (initialActiveOrgId && !hasSetCookieRef.current) {
      hasSetCookieRef.current = true
      setActiveOrgCookie(initialActiveOrgId).catch(() => {})
    }
  }, [initialActiveOrgId])

  // Self-hydration: fetch everything client-side when no server data was provided
  useEffect(() => {
    if (hydratedRef.current || initialMemberships.length > 0) return
    hydratedRef.current = true

    const hydrate = async () => {
      try {
        const supabase = createSupabaseBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          setMemberships([])
          setActiveOrgId(null)
          return
        }

        const [membershipResult, subResult] = await Promise.all([
          supabase
            .from('organization_members')
            .select(`
              organization_id,
              role,
              joined_at,
              organizations (id, name, unique_code)
            `)
            .eq('user_id', user.id),
          supabase
            .from('subscriptions')
            .select('id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .maybeSingle()
        ])

        if (membershipResult.error) {
          console.error('Error fetching memberships:', membershipResult.error)
          return
        }

        const newMemberships: UserOrg[] = (membershipResult.data ?? [])
          .filter((m: { organizations: unknown }) => m.organizations !== null)
          .map((m: { organization_id: string; role: OrgRole; joined_at: string; organizations: unknown }) => {
            const org = m.organizations as unknown as OrganizationData
            return {
              orgId: m.organization_id,
              name: org.name,
              uniqueCode: org.unique_code,
              role: m.role,
              joinedAt: m.joined_at,
            }
          })

        setMemberships(newMemberships)
        setIsSubscribed(!!subResult.data)

        if (newMemberships.length === 0) {
          router.replace(
            subResult.data ? '/onboarding/create-organization' : '/onboarding/start'
          )
          return
        }

        const cookieOrgId = await getActiveOrgCookie()
        const validOrgId =
          cookieOrgId && newMemberships.some((m) => m.orgId === cookieOrgId)
            ? cookieOrgId
            : newMemberships[0]?.orgId ?? null

        setActiveOrgId(validOrgId)
        if (validOrgId && validOrgId !== cookieOrgId) {
          setActiveOrgCookie(validOrgId).catch(() => {})
        }
      } finally {
        setIsLoading(false)
      }
    }

    hydrate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Derive active org from memberships
  const activeOrg = memberships.find((m) => m.orgId === activeOrgId) ?? null

  // Fetch memberships from Supabase (client-side)
  const refreshMemberships = useCallback(async () => {
    setIsLoading(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setMemberships([])
        setActiveOrgId(null)
        return
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
        `
        )
        .eq('user_id', user.id)

      if (error) {
        console.error('Error fetching memberships:', error)
        return
      }

      const newMemberships: UserOrg[] = (data ?? [])
        .filter((m: { organizations: unknown }) => m.organizations !== null)
        .map((m: { organization_id: string; role: OrgRole; joined_at: string; organizations: unknown }) => {
          // organizations is returned as an object (single relation) not an array
          const org = m.organizations as unknown as OrganizationData
          return {
            orgId: m.organization_id,
            name: org.name,
            uniqueCode: org.unique_code,
            role: m.role,
            joinedAt: m.joined_at,
          }
        })

      setMemberships(newMemberships)

      // If current activeOrgId is no longer valid, reset to first org or null
      if (activeOrgId && !newMemberships.some((m) => m.orgId === activeOrgId)) {
        const newActiveId = newMemberships[0]?.orgId ?? null
        setActiveOrgId(newActiveId)
        if (newActiveId) {
          await setActiveOrgCookie(newActiveId)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }, [activeOrgId])

  // Set active organization and persist to cookie
  const setActiveOrg = useCallback(
    async (orgId: string) => {
      if (orgId === activeOrgId) {
        return
      }

      pendingOrgIdRef.current = orgId
      setIsSwitchingOrg(true)
      setActiveOrgId(orgId)

      try {
        await setActiveOrgCookie(orgId)

        const parentPath = getParentListPath(pathname)
        if (parentPath) {
          router.push(parentPath)
        } else {
          router.refresh()
          // Same-page refresh: reset immediately since page content updates transparently
          pendingOrgIdRef.current = null
          setIsSwitchingOrg(false)
        }
      } catch (error) {
        console.error('Failed to switch organization', error)
        pendingOrgIdRef.current = null
        setIsSwitchingOrg(false)
        throw error
      }
    },
    [activeOrgId, router, pathname],
  )

  // Reset switching overlay when navigation completes (pathname changes after router.push)
  useEffect(() => {
    if (pendingOrgIdRef.current) {
      pendingOrgIdRef.current = null
      setIsSwitchingOrg(false)
    }
  }, [pathname])

  // Re-fetch memberships when tab becomes visible, but only if it's been
  // hidden for at least 5 minutes to avoid unnecessary fetches on quick
  // tab switches.
  const lastHiddenAtRef = useRef<number>(0)
  useEffect(() => {
    const COOLDOWN_MS = 5 * 60 * 1000

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now()
      } else if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastHiddenAtRef.current
        if (lastHiddenAtRef.current > 0 && elapsed >= COOLDOWN_MS) {
          refreshMemberships()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshMemberships])

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
    [memberships, activeOrgId, activeOrg, setActiveOrg, refreshMemberships, isLoading, isSubscribed, isSwitchingOrg]
  )

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  )
}

// Hook
export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider')
  }
  return context
}
