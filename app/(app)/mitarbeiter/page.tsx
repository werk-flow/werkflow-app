import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies'
import { InviteDialog } from '@/components/mitarbeiter/invite-dialog'
import { MitarbeiterTabs } from '@/components/mitarbeiter/mitarbeiter-tabs'
import { RoleChangeBanner } from '@/components/mitarbeiter/role-change-banner'
import type { OrgMember } from '@/components/mitarbeiter/members-table'
import type { Invite } from '@/components/mitarbeiter/invitations-table'
import type { OrgRole } from '@/lib/members/actions'

export default async function MitarbeiterPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  // Fetch members via RPC (already ordered by role and last_name)
  const { data: members, error: membersError } = await supabase.rpc('get_org_members', {
    p_org_id: activeOrgId,
  })

  if (membersError) {
    console.error('Error fetching members:', membersError)
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Mitarbeiter</h1>
        <p className="mt-4 text-destructive">
          Fehler beim Laden der Mitarbeiter: {membersError.message || 'Unbekannter Fehler'}
        </p>
      </div>
    )
  }

  // Fetch invitations for this organization (including invited_role)
  const { data: invites, error: invitesError } = await supabase
    .from('organization_invites')
    .select('id, email, status, created_at, expires_at, accepted_at, invited_role')
    .eq('organization_id', activeOrgId)
    .order('created_at', { ascending: false })

  if (invitesError) {
    console.error('Error fetching invites:', invitesError)
  }

  const memberList = (members as OrgMember[]) || []
  const inviteList = (invites as Invite[]) || []

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Mitarbeiter</h1>
        <InviteDialog />
      </header>

      <div className="flex-1 overflow-auto p-6">
        <RoleChangeBanner />
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



