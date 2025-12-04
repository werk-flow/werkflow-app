import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserOrg } from '@/components/organization/organization-context'

type OrganizationData = {
  id: string
  name: string
  unique_code: string
}

/**
 * Cached user fetch - deduplicates within a single request render.
 * If called multiple times in the same request (e.g., layout + page),
 * only makes one actual Supabase call.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createSupabaseServerClient()
  return supabase.auth.getUser()
})

/**
 * Cached memberships fetch - deduplicates within a single request render.
 * Returns the user's organization memberships with org details.
 */
export const getCachedMemberships = cache(async (userId: string): Promise<UserOrg[]> => {
  const supabase = await createSupabaseServerClient()

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
    .eq('user_id', userId)

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
})

/**
 * Cached subscription status - deduplicates within a single request render.
 * Uses React's cache() to avoid redundant calls within the same request.
 * 
 * Note: We cannot use unstable_cache here because it doesn't support
 * dynamic data sources like cookies() which Supabase client requires.
 */
export const getCachedSubscriptionStatus = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .single()

  if (error) {
    // PGRST116 means no rows returned - user has no subscription
    if (error.code === 'PGRST116') {
      return false
    }
    console.error('Error fetching subscription:', error)
    return false
  }

  return data?.status === 'active'
})

/**
 * Cached member count fetch - deduplicates within a single request render.
 * Returns the count of members in an organization.
 */
export const getCachedMemberCount = cache(async (orgId: string): Promise<number | null> => {
  const supabase = await createSupabaseServerClient()

  const { count, error } = await supabase
    .from('organization_members')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  if (error) {
    console.error('Error fetching member count:', error)
    return null
  }

  return count
})


