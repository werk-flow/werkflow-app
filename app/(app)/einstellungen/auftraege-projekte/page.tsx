import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AuftraegeColumnSettingsForm } from '@/components/settings/auftraege-column-settings-form'
import {
  getCachedMemberships,
  getCachedOrganizationUserPreferences,
  getCachedUser,
} from '@/lib/data/cached'
import { resolveActiveOrgId } from '@/lib/org/cookies'

export default async function JobsProjectsSettingsPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ])

  if (!user) {
    redirect('/login')
  }

  const memberships = await getCachedMemberships(user.id)
  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id)
  const activeMembership =
    memberships.find((membership) => membership.orgId === activeOrgId) ??
    memberships[0] ??
    null

  if (!activeMembership) {
    redirect('/dashboard')
  }

  const { visibleColumns } = await getCachedOrganizationUserPreferences(
    activeMembership.orgId,
    user.id
  )

  return (
    <AuftraegeColumnSettingsForm
      initialVisibleColumns={visibleColumns}
      organizationName={activeMembership.name}
    />
  )
}
