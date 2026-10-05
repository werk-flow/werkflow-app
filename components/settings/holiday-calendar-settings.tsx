'use client';

import { ClosureDaysCard } from '@/components/settings/closure-days-card';
import { HolidayRegionCard } from '@/components/settings/holiday-region-card';
import type { ClosureDay } from '@/lib/personnel/targets';

type HolidayCalendarSettingsProps = {
  holidayRegion: string | null;
  closureDays: ClosureDay[];
  role: 'admin' | 'buero' | 'employee';
};

export function HolidayCalendarSettings({ holidayRegion, closureDays, role }: HolidayCalendarSettingsProps) {
  const canEditRegion = role === 'admin';
  const canEditClosureDays = role === 'admin' || role === 'buero';

  return (
    <>
      <HolidayRegionCard holidayRegion={holidayRegion} canEditRegion={canEditRegion} />

      <ClosureDaysCard closureDays={closureDays} canEditClosureDays={canEditClosureDays} />
    </>
  );
}
