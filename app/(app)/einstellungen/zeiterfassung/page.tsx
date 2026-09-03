import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { TimeTrackingSettingsForm } from '@/components/settings/time-tracking-settings-form'
import { HolidayCalendarSettings } from '@/components/settings/holiday-calendar-settings'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
      {/* Time rules live in the Zeiterfassung area (owner ruling 2, 2026-09-03); settings only links there. */}
      <Card>
        <CardHeader>
          <CardTitle>Zeitkonten, Regeln & Lohnexport</CardTitle>
          <CardDescription>
            Arbeitszeitregeln, Zeitkonten und die Lohnarten-Zuordnung werden im
            Bereich Zeiterfassung gepflegt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/zeiterfassung/einstellungen">Zu den Zeitkonto-Regeln</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
