import type { OfficeStartRead } from '@/components/dashboard/office-start-sections';
import { OwnerStartView } from '@/components/dashboard/owner-start';
import type { AttentionTask } from '@/lib/attention/types';

const BUSINESS_DATE = '2026-11-19';

function maintenance(sourceId: string, dueDate: string, overdue: boolean): AttentionTask {
  return {
    sourceType: 'maintenance_due',
    sourceId,
    equipmentLabel: 'Gasbrennwertkessel',
    siteName: 'Heizzentrale Lindenhof',
    dueDate,
    overdue,
    href: '/service/wartung?q=WPL-2026-0007',
  };
}

function callback(sourceId: string, requestNumber: string, callbackDueAt: string): AttentionTask {
  return {
    sourceType: 'client_request_callback_overdue',
    sourceId,
    requestNumber,
    summary: 'Heizung fällt aus',
    urgency: 'normal',
    callbackDueAt,
    ownerName: 'Erika Musterfrau',
    ownerUnavailable: false,
    assignedToMe: false,
  };
}

/**
 * Admin's Aufgaben on Thursday, 19 November 2026: an overdue callback past the
 * threshold and one inside it, four Übergaben completed on 2 November, two
 * corrections and a vacation request Admin approves, a session approval, a
 * blocker past its review date, an open dispatch question, and a Wartung
 * overdue since 12 November beside one due next week. Only the exceptions
 * reach the owner start.
 */
const TASKS: AttentionTask[] = [
  callback('00000000-0000-4000-8000-000000000101', 'AN-2026-101', '2026-11-12T09:00:00.000Z'),
  callback('00000000-0000-4000-8000-000000000102', 'AN-2026-102', '2026-11-18T09:00:00.000Z'),
  ...[1, 2, 3, 4].map(
    (index): AttentionTask => ({
      sourceType: 'work_handover_review',
      sourceId: `00000000-0000-4000-8000-00000000020${index}`,
      targetType: 'job',
      targetLabel: `A-2026-20${index} · Heizung tauschen`,
      targetHref: `/auftraege/A-2026-20${index}/uebergabe`,
      packageState: 'missing',
      completedOn: '2026-11-02',
      stateVersion: 'job:1:0',
    }),
  ),
  {
    sourceType: 'time_correction_approval',
    sourceId: '00000000-0000-4000-8000-000000000301',
    personName: 'Max Mustermann',
    correctionLabel: 'Vergessene Stempelung',
    stateVersion: '1',
    openSinceDays: 1,
  },
  {
    sourceType: 'time_change_request_approval',
    sourceId: '00000000-0000-4000-8000-000000000302',
    personName: 'Max Mustermann',
    requestType: 'edit',
    openSinceDays: 0,
  },
  {
    sourceType: 'time_session_approval',
    sourceId: '00000000-0000-4000-8000-000000000303',
    personName: 'Max Mustermann',
    date: '2026-11-18',
    jobTitle: null,
    openSinceDays: 1,
  },
  {
    sourceType: 'vacation_request_approval',
    sourceId: '00000000-0000-4000-8000-000000000304',
    personName: 'Max Mustermann',
    startDate: '2026-12-21',
    endDate: '2026-12-23',
    dayPortion: 'full',
    totalDays: 3,
    openSinceDays: 2,
  },
  {
    sourceType: 'work_blocker_review',
    sourceId: '00000000-0000-4000-8000-000000000401',
    targetLabel: 'A-2026-401 · Bad sanieren',
    targetHref: '/auftraege/A-2026-401',
    blockerKind: 'blocker',
    nextReviewDate: '2026-11-17',
    responsibleName: 'Erika Musterfrau',
    stateVersion: 'review:1:2026-11-17',
  },
  {
    sourceType: 'dispatch_challenge_open',
    sourceId: '00000000-0000-4000-8000-000000000501',
    personName: 'Max Mustermann',
    reason: 'Ersatzteil fehlt noch',
    jobTitle: 'Therme warten',
    acknowledgementId: '00000000-0000-4000-8000-000000000502',
    stateVersion: '1',
  },
  maintenance('00000000-0000-4000-8000-000000000601', '2026-11-12', true),
  maintenance('00000000-0000-4000-8000-000000000602', '2026-11-25', false),
];

/** Tasks that are no exception yet: a callback overdue for one workday and a Wartung due next week. */
const NO_EXCEPTIONS: AttentionTask[] = [
  callback('00000000-0000-4000-8000-000000000102', 'AN-2026-102', '2026-11-18T09:00:00.000Z'),
  maintenance('00000000-0000-4000-8000-000000000602', '2026-11-25', false),
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

const attention = (tasks: AttentionTask[]) => ({ tasks, businessDate: BUSINESS_DATE });

const CASES = [
  ['filled', read('current', attention(TASKS))],
  ['empty', read('current', attention(NO_EXCEPTIONS))],
  ['attention-failed', read('failed', attention([]))],
  ['attention-loading', read('loading', attention([]))],
  ['attention-stale-empty', read('stale', attention([]))],
] as const;

export function OwnerStartContractFixture() {
  return (
    <>
      {CASES.map(([name, attentionRead]) => (
        <div key={name} data-testid={`owner-start-${name}`}>
          <OwnerStartView attention={attentionRead} />
        </div>
      ))}
    </>
  );
}
