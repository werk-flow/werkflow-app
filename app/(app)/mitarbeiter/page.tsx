import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies'
import { getCachedUser } from '@/lib/data/cached'
import { InviteDialog } from '@/components/mitarbeiter/invite-dialog'
import { MitarbeiterTabs } from '@/components/mitarbeiter/mitarbeiter-tabs'
import type { OrgMember } from '@/components/mitarbeiter/members-table'
import type { Invite } from '@/components/mitarbeiter/invitations-table'
import type { OrgRole } from '@/lib/members/actions'

export default async function MitarbeiterPage() {
  // Use cached user - deduplicates with layout's call
  const { data: { user } } = await getCachedUser()

  if (!user) {
    redirect('/login')
  }

  const cookieStore = await cookies()
  const activeOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Mitarbeiter</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    )
  }

  // Get Supabase client for page-specific queries
  const supabase = await createSupabaseServerClient()

  // Check current user's membership and role in this org
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', activeOrgId)
    .eq('user_id', user.id)
    .single()

  const currentUserRole = membership?.role as OrgRole | undefined
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'manager'

  // Redirect non-admins and non-managers to dashboard
  if (!isAdminOrManager) {
    redirect('/dashboard')
  }

  // Fetch members and invites in parallel
  const [membersResult, invitesResult] = await Promise.all([
    supabase.rpc('get_org_members', { p_org_id: activeOrgId }),
    supabase
      .from('organization_invites')
      .select('id, email, status, created_at, expires_at, accepted_at, invited_role')
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false })
  ])

  if (membersResult.error) {
    console.error('Error fetching members:', membersResult.error)
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Mitarbeiter</h1>
        <p className="mt-4 text-destructive">
          Fehler beim Laden der Mitarbeiter: {membersResult.error.message || 'Unbekannter Fehler'}
        </p>
      </div>
    )
  }

  if (invitesResult.error) {
    console.error('Error fetching invites:', invitesResult.error)
  }

  const memberList = (membersResult.data as OrgMember[]) || []
  const inviteList = (invitesResult.data as Invite[]) || []

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Mitarbeiter</h1>
        <InviteDialog />
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <MitarbeiterTabs
          members={memberList}
          invites={inviteList}
          currentUserId={user.id}
          currentUserRole={currentUserRole!}
        />
      </div>
    </div>
  )
}
