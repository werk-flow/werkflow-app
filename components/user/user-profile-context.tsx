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
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

// Types
export type UserProfile = {
  id: string
  firstName: string
  lastName: string
  email: string
}

export type UserProfileContextValue = {
  profile: UserProfile | null
  isLoading: boolean
  refreshProfile: () => Promise<void>
}

// Context
const UserProfileContext = createContext<UserProfileContextValue | null>(null)

// Provider props
type UserProfileProviderProps = {
  children: ReactNode
  initialProfile?: UserProfile | null
}

export function UserProfileProvider({
  children,
  initialProfile = null,
}: UserProfileProviderProps) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile)
  const [isLoading, setIsLoading] = useState(initialProfile === null)
  const hydratedRef = useRef(false)

  // Sync state when server-provided props change
  useEffect(() => {
    if (initialProfile !== null) {
      setProfile(initialProfile)
    }
  }, [initialProfile])

  // Self-hydration: fetch profile client-side when no server data was provided
  useEffect(() => {
    if (hydratedRef.current || initialProfile !== null) return
    hydratedRef.current = true
    refreshProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch profile from Supabase (client-side)
  const refreshProfile = useCallback(async () => {
    setIsLoading(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || !user.email) {
        setProfile(null)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('id', user.id)
        .single()

      if (error) {
        console.error('Error fetching profile:', error)
        return
      }

      if (data) {
        setProfile({
          id: data.id,
          firstName: data.first_name,
          lastName: data.last_name,
          email: user.email,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const value = useMemo<UserProfileContextValue>(
    () => ({
      profile,
      isLoading,
      refreshProfile,
    }),
    [profile, isLoading, refreshProfile]
  )

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  )
}

// Hook
export function useUserProfile() {
  const context = useContext(UserProfileContext)
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileProvider')
  }
  return context
}

