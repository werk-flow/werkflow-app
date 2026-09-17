import { DayView } from '@/components/kalender/day-view/day-view';
import { useCalendarRangeData } from '@/components/kalender/use-calendar-range-data';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { BannerProvider } from '@/components/ui/banner';
import { getCalendarFetchRange } from '@/lib/calendar/navigation';
import { getDefaultTimeTrackingSettings } from '@/lib/time-tracking/settings';
import { contractJob, CalendarOrganizationContext } from './calendar-service-boundaries';
import { updateJob } from './day-view-service-boundaries';

const date = new Date(2026, 8, 8, 12);
const range = getCalendarFetchRange(date, 'day');
const job = { ...contractJob('Prüfauftrag ziehen'), plannedDate: '2026-09-08', plannedTime: '09:00', estimatedDurationMinutes: 60, assignedUserIds: ['worker'] };
const jobs = [job];
const initial = { range, jobs };
const required = ['jobs'] as const;
const members = [{ user_id: 'worker', first_name: 'Alex', last_name: 'Test', email: 'worker@example.invalid', role: 'employee' }];
function OwnedDayView(): React.JSX.Element {
  const owner = useCalendarRangeData({ organizationId: 'org-a', identityKey: 'manager:admin', needed: range, requiredDatasets: required, initial, onReadFailed: () => {} });
  return <section aria-label="Tageskalender">
    <output aria-label="Laufende Speicherung">{owner.isMutating ? 'aktiv' : 'frei'}</output>
    <div style={{ height: 500, width: 1000 }}>
      <DayView date={date} entries={[]} jobs={jobs} members={members} organizationSettings={getDefaultTimeTrackingSettings('org-a')} currentUserId="manager" currentUserRole="admin" isAdminOrManager isLoading={false} onRefresh={() => { void owner.refreshAll(); }} onSilentRefresh={() => { void owner.refreshAll(); }} onOperationStart={owner.beginMutation} onUpdateJob={updateJob} />
    </div>
  </section>;
}
export function DayViewContractFixture(): React.JSX.Element {
  return <CalendarOrganizationContext.Provider value="org-a"><RealtimeProvider><BannerProvider><OwnedDayView /></BannerProvider></RealtimeProvider></CalendarOrganizationContext.Provider>;
}
