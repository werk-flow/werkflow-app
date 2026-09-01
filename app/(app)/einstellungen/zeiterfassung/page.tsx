import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { TimeTrackingSettingsForm } from '@/components/settings/time-tracking-settings-form'
import { HolidayCalendarSettings } from '@/components/settings/holiday-calendar-settings'
import TimeAccountSettingsPage from '@/app/(app)/zeiterfassung/einstellungen/page'
import {
  getCachedMemberships,
  getCachedOrganizationCalendar,
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

  const [settings, calendar] = await Promise.all([
    getCachedOrganizationSettings(activeMembership.orgId),
    getCachedOrganizationCalendar(activeMembership.orgId),
  ])

  return (
    <div className="space-y-6">
      <TimeTrackingSettingsForm
        initialSettings={{
          breakMode: settings.breakMode,
          autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
          autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
        }}
        role={activeMembership.role}
      />
      <HolidayCalendarSettings
        holidayRegion={calendar.holidayRegion}
        closureDays={calendar.closureDays}
        role={activeMembership.role}
      />
      <TimeAccountSettingsPage embedded />
    </div>
  )
}
