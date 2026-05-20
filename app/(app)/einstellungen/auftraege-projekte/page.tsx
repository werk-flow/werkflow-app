import { cookies } from 'next/headers';
import { redirect } from 'next/navigation'

import { AuftraegeColumnSettingsForm } from '@/components/settings/auftraege-column-settings-form'
import {
  getCachedMemberships,
  getCachedOrganizationUserPreferences,
  getCachedUser,
} from '@/lib/data/cached'
import { DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS } from '@/lib/jobs/auftraege-table-columns'
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

  let visibleColumns = [...DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS]

  try {
    const preferences = await getCachedOrganizationUserPreferences(
      activeMembership.orgId,
      user.id
    )
    visibleColumns = preferences.visibleColumns
  } catch (error) {
    console.error('Error loading organization user preferences:', error)
  }

  return (
    <AuftraegeColumnSettingsForm
      initialVisibleColumns={visibleColumns}
      organizationName={activeMembership.name}
    />
  )
}
