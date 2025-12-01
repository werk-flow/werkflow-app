import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies'
import { isUserSubscribed } from '@/lib/subscription/helpers'
import {
  OrganizationProvider,
  type UserOrg,
} from '@/components/organization/organization-context'
import Sidebar from '@/components/sidebar/Sidebar'

type OrganizationData = {
  id: string
  name: string
  unique_code: string
}

async function getMemberships(userId: string): Promise<UserOrg[]> {
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
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch memberships
  const memberships = await getMemberships(user.id)

  // If user has no organizations, redirect to onboarding
  if (memberships.length === 0) {
    // Check if user has an active subscription
    const subscribed = await isUserSubscribed(user.id)
    
    if (subscribed) {
      // User is subscribed but has no orgs - redirect to create organization
      redirect('/onboarding/create-organization')
    } else {
      // User is not subscribed - redirect to onboarding start
      redirect('/onboarding/start')
    }
  }

  // Check subscription status
  const subscribed = await isUserSubscribed(user.id)

  // Read active org from cookie
  const cookieStore = await cookies()
  const storedOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value

  // Validate stored org ID against memberships, fallback to first org
  // Note: The middleware handles setting the cookie if it's missing/invalid
  // Here we just determine what the active org should be for the UI
  let activeOrgId: string | null = null
  if (storedOrgId && memberships.some((m) => m.orgId === storedOrgId)) {
    activeOrgId = storedOrgId
  } else if (memberships.length > 0) {
    // Fallback to first org - ensures there's ALWAYS an active org when user has memberships
    activeOrgId = memberships[0].orgId
  }

  return (
    <OrganizationProvider
      initialMemberships={memberships}
      initialActiveOrgId={activeOrgId}
      initialIsSubscribed={subscribed}
    >
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </OrganizationProvider>
  )
}

