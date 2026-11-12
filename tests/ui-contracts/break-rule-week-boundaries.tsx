// The week views under a break rule that changed midweek: the Zeiterfassung
// week chart and the Mitarbeiter detail read the week on the client and must
// resolve each day against the rule version that applied to it.
import { WeeklyHoursChart } from '@/components/zeiterfassung/weekly-hours-chart';
import { MitarbeiterDetailTimeCards } from '@/components/mitarbeiter/mitarbeiter-detail-time-cards';
import { useMitarbeiterDetailLiveTime } from '@/components/mitarbeiter/use-mitarbeiter-detail-live-time';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import type { BreakPolicy } from '@/lib/time-tracking/settings';
import type { TimeEntry } from '@/lib/time-tracking/types';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000161';
const USER_ID = '20000000-0000-4000-8000-000000000161';

/** Manual breaks until Tuesday 08:00 Berlin, then 30 minutes from six hours on. */
const RULE_CHANGED_ON_TUESDAY: BreakPolicy = {
  breakMode: 'automatic',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  breakPolicyHistory: [
    {
      breakMode: 'manual',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    },
    {
      breakMode: 'automatic',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      effectiveFrom: '2026-09-08T06:00:00.000Z',
    },
  ],
};

function entry(id: string, entryType: TimeEntry['entryType'], timestamp: string): TimeEntry {
  return {
    id,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    entryType,
    timestamp,
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Ten hours on Monday, 7 September 2026, and on Tuesday, both 07:00 to 17:00 Berlin. */
const WEEK_ENTRIES: TimeEntry[] = [
  entry('30000000-0000-4000-8000-000000000001', 'clock_in', '2026-09-07T05:00:00.000Z'),
  entry('30000000-0000-4000-8000-000000000002', 'clock_out', '2026-09-07T15:00:00.000Z'),
  entry('30000000-0000-4000-8000-000000000003', 'clock_in', '2026-09-08T05:00:00.000Z'),
  entry('30000000-0000-4000-8000-000000000004', 'clock_out', '2026-09-08T15:00:00.000Z'),
];

/** The `time-entries` read: the recorded entries inside the requested range. */
export function readBreakRuleWeekEntries(input: unknown): { success: true; entries: TimeEntry[] } {
  const range = input && typeof input === 'object' && 'from' in input && 'to' in input ? input : null;
  const from = range ? new Date(String(range.from)).getTime() : Number.NEGATIVE_INFINITY;
  const to = range ? new Date(String(range.to)).getTime() : Number.POSITIVE_INFINITY;
  return {
    success: true,
    entries: WEEK_ENTRIES.filter((row) => {
      const at = new Date(row.timestamp).getTime();
      return at >= from && at <= to;
    }),
  };
}

function ZeiterfassungWeek() {
  const { weekData, todayIndex, weekLabel, weekTargets } = useWeeklyTimeData({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    breakPolicy: RULE_CHANGED_ON_TUESDAY,
  });
  return (
    <section aria-label="Zeiterfassung">
      <WeeklyHoursChart
        weekData={weekData}
        todayIndex={todayIndex}
        weekLabel={weekLabel}
        weekTargets={weekTargets}
      />
    </section>
  );
}

function MitarbeiterDetailWeek() {
  const liveTime = useMitarbeiterDetailLiveTime({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    breakPolicy: RULE_CHANGED_ON_TUESDAY,
    initialWeek: null,
  });
  return (
    <section aria-label="Mitarbeiter">
      <MitarbeiterDetailTimeCards liveTime={liveTime} breakPolicy={RULE_CHANGED_ON_TUESDAY} />
    </section>
  );
}

export function BreakRuleWeekFixture() {
  return (
    <>
      <ZeiterfassungWeek />
      <MitarbeiterDetailWeek />
    </>
  );
}
