'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { setActiveOrgCookie } from '@/lib/org/actions'
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
  initialMemberships: UserOrg[]
  initialActiveOrgId: string | null
  initialIsSubscribed: boolean
}

export function OrganizationProvider({
  children,
  initialMemberships,
  initialActiveOrgId,
  initialIsSubscribed,
}: OrganizationProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [memberships, setMemberships] = useState<UserOrg[]>(initialMemberships)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(initialActiveOrgId)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubscribed] = useState(initialIsSubscribed)
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false)
  // Track the org ID we're switching TO - used to know when server data has arrived
  const pendingOrgIdRef = useRef<string | null>(null)

  // Sync state when initial props change (e.g., after router.refresh())
  useEffect(() => {
    setMemberships(initialMemberships)
  }, [initialMemberships])

  useEffect(() => {
    setActiveOrgId(initialActiveOrgId)
  }, [initialActiveOrgId])

  // Proactively set the cookie when the active org is resolved from fallback
  // so that subsequent server-side renders can read it immediately.
  const hasSetCookieRef = useRef(false)
  useEffect(() => {
    if (initialActiveOrgId && !hasSetCookieRef.current) {
      hasSetCookieRef.current = true
      setActiveOrgCookie(initialActiveOrgId).catch(() => {})
    }
  }, [initialActiveOrgId])

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

      // Track which org we're switching to
      pendingOrgIdRef.current = orgId
      setIsSwitchingOrg(true)
      setActiveOrgId(orgId)

      try {
        await setActiveOrgCookie(orgId)

        // When on an org-specific detail page, redirect to the parent list
        // page instead of refreshing (the entity won't exist in the new org).
        const parentPath = getParentListPath(pathname)
        if (parentPath) {
          router.push(parentPath)
        } else {
          router.refresh()
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

  // Reset switching state when server data arrives for the org we switched to
  useEffect(() => {
    // Only reset if we were switching and the server now reflects the target org
    if (pendingOrgIdRef.current && initialActiveOrgId === pendingOrgIdRef.current) {
      pendingOrgIdRef.current = null
      setIsSwitchingOrg(false)
    }
  }, [initialActiveOrgId])

  // Re-fetch memberships on visibility change (when tab becomes visible)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshMemberships()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshMemberships])

  const value: OrgContextValue = {
    memberships,
    activeOrgId,
    activeOrg,
    setActiveOrg,
    refreshMemberships,
    isLoading,
    isSubscribed,
    isSwitchingOrg,
  }

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
