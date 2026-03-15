'use client'

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
  const [, startTransition] = useTransition()
  const [memberships, setMemberships] = useState<UserOrg[]>(initialMemberships)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(initialActiveOrgId)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(initialIsSubscribed)
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false)
  const pendingOrgIdRef = useRef<string | null>(null)

  // Sync state when server-provided props change (e.g. after router.refresh())
  useEffect(() => {
    setMemberships(initialMemberships)
  }, [initialMemberships])

  useEffect(() => {
    setActiveOrgId(initialActiveOrgId)
  }, [initialActiveOrgId])

  useEffect(() => {
    setIsSubscribed(initialIsSubscribed)
  }, [initialIsSubscribed])

  // Proactively set the cookie when the active org is resolved from fallback
  // so that subsequent server-side renders can read it immediately.
  const hasSetCookieRef = useRef(false)
  useEffect(() => {
    if (initialActiveOrgId && !hasSetCookieRef.current) {
      hasSetCookieRef.current = true
      setActiveOrgCookie(initialActiveOrgId).catch(() => {})
    }
  }, [initialActiveOrgId])

  const activeOrg = memberships.find((m) => m.orgId === activeOrgId) ?? null

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

        // Wrap navigation in startTransition so React keeps showing the
        // current UI (with the overlay) until the server finishes rendering
        // the new org data. This prevents the hydration mismatch that occurs
        // when PPR serves a stale static shell while dynamic data is still
        // streaming for the new org.
        startTransition(() => {
          if (parentPath) {
            router.push(parentPath)
          } else {
            router.refresh()
          }
        })
      } catch (error) {
        console.error('Failed to switch organization', error)
        pendingOrgIdRef.current = null
        setIsSwitchingOrg(false)
        throw error
      }
    },
    [activeOrgId, router, pathname, startTransition],
  )

  // Reset switching state when server data arrives for the target org
  useEffect(() => {
    if (pendingOrgIdRef.current && initialActiveOrgId === pendingOrgIdRef.current) {
      pendingOrgIdRef.current = null
      setIsSwitchingOrg(false)
    }
  }, [initialActiveOrgId])

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
