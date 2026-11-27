import { OfficeStartView, type OfficeStartRead } from '@/components/dashboard/office-start-sections';
import type { AttentionTask } from '@/lib/attention/types';

/**
 * Five jobs past their last visit and four Wartungen due, two of them
 * overdue, behind a time approval and a vacation request the start page
 * leaves out.
 */
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
  ...(
    [
      ['2026-11-02', true, 'Heizzentrale Lindenhof'],
      ['2026-11-12', true, null],
      ['2026-11-30', false, 'Heizzentrale Lindenhof'],
      ['2026-12-04', false, 'Heizzentrale Lindenhof'],
    ] as const
  ).map(
    ([dueDate, overdue, siteName], index): AttentionTask => ({
      sourceType: 'maintenance_due',
      sourceId: `00000000-0000-4000-8000-00000000010${index}`,
      equipmentLabel: index === 0 ? 'Gasbrennwertkessel, Speicher' : 'Enthärtungsanlage',
      siteName,
      dueDate,
      overdue,
      href: `/service/wartung?q=WPL-2026-000${index}`,
    }),
  ),
];

const refresh = () => Promise.resolve();

/** A read in the state the live view reports: current, stale with its last data, still loading, or failed without data. */
function read<T>(state: 'current' | 'stale' | 'loading' | 'failed', data: T): OfficeStartRead<T> {
  if (state === 'loading')
    return { data: undefined, isLoading: true, isRefreshing: true, isStale: false, refresh };
  if (state === 'failed')
    return { data: undefined, isLoading: false, isRefreshing: false, isStale: true, refresh };
  return { data, isLoading: false, isRefreshing: false, isStale: state === 'stale', refresh };
}

const CASES = [
  ['filled', read('current', { tasks: TASKS })],
  ['empty', read('current', { tasks: [] })],
  ['attention-failed', read('failed', { tasks: [] })],
  ['attention-loading', read('loading', { tasks: [] })],
  ['attention-stale', read('stale', { tasks: TASKS })],
  ['attention-stale-empty', read('stale', { tasks: [] })],
] as const;

export function OfficeStartContractFixture() {
  return (
    <>
      {CASES.map(([name, attention]) => (
        <div key={name} data-testid={`office-start-${name}`}>
          <OfficeStartView attention={attention} />
        </div>
      ))}
    </>
  );
}
