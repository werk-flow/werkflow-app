import { OfficeStartSections } from '@/components/dashboard/office-start-sections';
import type { AttentionTask } from '@/lib/attention/types';

/** Five jobs past their last visit, behind a time approval and a vacation request the start page leaves out. */
const TASKS: AttentionTask[] = [
  {
    sourceType: 'time_session_approval',
    sourceId: 'session-1',
    personName: 'Max Mustermann',
    date: '2026-11-16',
    jobTitle: null,
    openSinceDays: 1,
  },
  {
    sourceType: 'vacation_request_approval',
    sourceId: 'vacation-1',
    personName: 'Max Mustermann',
    startDate: '2026-12-21',
    endDate: '2026-12-23',
    dayPortion: 'full',
    totalDays: 3,
    openSinceDays: 2,
  },
  ...[1, 2, 3, 4, 5].map(
    (day): AttentionTask => ({
      sourceType: 'job_past_last_visit',
      sourceId: `00000000-0000-4000-8000-00000000000${day}`,
      jobLabel: `A-2026-00${day} · Heizung warten`,
      jobHref: `/auftraege/A-2026-00${day}`,
      lastVisitDate: `2026-11-0${day}`,
    }),
  ),
];

export function OfficeStartContractFixture() {
  return (
    <>
      <div data-testid="office-start-filled">
        <OfficeStartSections tasks={TASKS} overdueMaintenance={2} />
      </div>
      <div data-testid="office-start-empty">
        <OfficeStartSections tasks={[]} overdueMaintenance={0} />
      </div>
      <div data-testid="office-start-maintenance-unknown">
        <OfficeStartSections tasks={[]} overdueMaintenance={null} />
      </div>
    </>
  );
}
