import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { User } from '@supabase/supabase-js'
import type { UserOrg } from '@/components/organization/organization-context'

type OrganizationData = {
  id: string
  name: string
  unique_code: string
}

// Tag helpers for cache invalidation in server actions
export const CACHE_TAGS = {
  memberships: (userId: string) => `memberships-${userId}`,
  subscription: (userId: string) => `subscription-${userId}`,
  profile: (userId: string) => `profile-${userId}`,
  memberCount: (orgId: string) => `member-count-${orgId}`,
  clients: (orgId: string) => `clients-${orgId}`,
  jobs: (orgId: string) => `jobs-${orgId}`,
  projects: (orgId: string) => `projects-${orgId}`,
} as const

const REVALIDATE_SECONDS = 300 // 5 minutes safety net

/**
 * Cached user fetch for page rendering — deduplicates within a single
 * request via React cache(). Uses getUser() which validates the JWT
 * against Supabase Auth servers (one network roundtrip per request).
 */
export const getCachedUser = cache(async () => {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return {
    data: { user: user ?? null },
    error,
  }
})

/**
 * Validates the JWT against Supabase Auth servers and returns the
 * authenticated User, or null if the token is invalid/expired/revoked.
 *
 * This MUST use getUser() (network roundtrip) rather than getSession()
 * because server actions use the returned user ID with the admin client
 * (which bypasses RLS). Without server-side validation, a revoked or
 * banned user with an unexpired JWT could still execute privileged
 * operations.
 *
 * Deduplicates within a single request via React cache().
 */
export const getAuthenticatedUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
})

/**
 * Cross-request cached memberships fetch.
 * Uses unstable_cache with the admin client (no cookies needed) so results
 * persist across navigations. Tagged for on-demand revalidation.
 */
export const getCachedMemberships = cache(async (userId: string): Promise<UserOrg[]> => {
  const fetchMemberships = unstable_cache(
    async (uid: string): Promise<UserOrg[]> => {
      const admin = createSupabaseAdminClient()

      const { data, error } = await admin
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
        .eq('user_id', uid)

      if (error) {
        console.error('Error fetching memberships:', error)
        return []
      }

      return (data ?? [])
        .filter((m) => m.organizations !== null)
        .map((m) => {
          const org = m.organizations as unknown as OrganizationData
          return {
            orgId: m.organization_id,
            name: org.name,
            uniqueCode: org.unique_code,
            role: m.role,
            joinedAt: m.joined_at,
          }
        })
    },
    [`memberships-${userId}`],
    { tags: [CACHE_TAGS.memberships(userId)], revalidate: REVALIDATE_SECONDS }
  )

  return fetchMemberships(userId)
})

/**
 * Cross-request cached subscription status.
 */
export const getCachedSubscriptionStatus = cache(async (userId: string): Promise<boolean> => {
  const fetchSubscription = unstable_cache(
    async (uid: string): Promise<boolean> => {
      const admin = createSupabaseAdminClient()

      const { data, error } = await admin
        .from('subscriptions')
        .select('status')
        .eq('user_id', uid)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return false
        }
        console.error('Error fetching subscription:', error)
        return false
      }

      return data?.status === 'active'
    },
    [`subscription-${userId}`],
    { tags: [CACHE_TAGS.subscription(userId)], revalidate: REVALIDATE_SECONDS }
  )

  return fetchSubscription(userId)
})

/**
 * Cross-request cached member count.
 */
export const getCachedMemberCount = cache(async (orgId: string): Promise<number | null> => {
  const fetchMemberCount = unstable_cache(
    async (oid: string): Promise<number | null> => {
      const admin = createSupabaseAdminClient()

      const { count, error } = await admin
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', oid)

      if (error) {
        console.error('Error fetching member count:', error)
        return null
      }

      return count
    },
    [`member-count-${orgId}`],
    { tags: [CACHE_TAGS.memberCount(orgId)], revalidate: REVALIDATE_SECONDS }
  )

  return fetchMemberCount(orgId)
})

export type UserProfile = {
  id: string
  firstName: string
  lastName: string
  email: string
}

/**
 * Cross-request cached user profile.
 * Email is passed in since it comes from auth.users (already fetched in layout).
 */
export const getCachedUserProfile = cache(async (userId: string, email: string): Promise<UserProfile | null> => {
  const fetchProfile = unstable_cache(
    async (uid: string, em: string): Promise<UserProfile | null> => {
      const admin = createSupabaseAdminClient()

      const { data, error } = await admin
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('id', uid)
        .single()

      if (error) {
        console.error('Error fetching user profile:', error)
        return null
      }

      return {
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        email: em,
      }
    },
    [`profile-${userId}`],
    { tags: [CACHE_TAGS.profile(userId)], revalidate: REVALIDATE_SECONDS }
  )

  return fetchProfile(userId, email)
})
