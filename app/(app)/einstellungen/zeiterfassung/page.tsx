import Link from 'next/link';

import { TimeTrackingSettingsForm } from '@/components/settings/time-tracking-settings-form';
import { HolidayCalendarSettings } from '@/components/settings/holiday-calendar-settings';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCachedOrganizationCalendar, getCachedOrganizationSettings } from '@/lib/data/cached';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';

export default async function TimeTrackingSettingsPage() {
  const { membership: activeMembership } = await readSettingsSectionMembership('zeiterfassung');

  const [settings, calendar] = await Promise.all([
    getCachedOrganizationSettings(activeMembership.orgId),
    getCachedOrganizationCalendar(activeMembership.orgId),
  ]);

  return (
    <div className="space-y-6">
      <LiveRouteRefresh tables={['organization_settings', 'organization_closure_days']} />
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
            Arbeitszeitregeln, Zeitkonten und die Lohnarten-Zuordnung werden im Bereich Zeiterfassung
            gepflegt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/zeiterfassung/einstellungen">Zu den Zeitkonto-Regeln</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
