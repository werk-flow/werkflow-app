import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { TimeTrackingSettingsForm } from '@/components/settings/time-tracking-settings-form'
import {
  getCachedMemberships,
  getCachedOrganizationSettings,
  getCachedUser,
} from '@/lib/data/cached'
import { resolveActiveOrgId } from '@/lib/org/cookies'

export default async function TimeTrackingSettingsPage() {
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

  const settings = await getCachedOrganizationSettings(activeMembership.orgId)

  return (
    <TimeTrackingSettingsForm
      initialSettings={{
        breakMode: settings.breakMode,
        autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
        autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
      }}
      role={activeMembership.role}
    />
  )
}
