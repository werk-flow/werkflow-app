import { useState } from 'react';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
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
  secondStep: null,
  breakPolicyHistory: [
    {
      breakMode: 'manual',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      secondStep: null,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    },
    {
      breakMode: 'automatic',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      secondStep: null,
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

/** Manual breaks, saved before the history existed: no recorded versions. */
const MANUAL_WITHOUT_VERSIONS: BreakPolicy = {
  breakMode: 'manual',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
  breakPolicyHistory: [],
};

/**
 * The page's server data after another session switched the automatic break
 * on, Tuesday 06:00 Berlin: the first save recorded the manual rule first.
 */
const SAVED_ON_TUESDAY: BreakPolicy = {
  breakMode: 'automatic',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
  breakPolicyHistory: [
    {
      breakMode: 'manual',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      secondStep: null,
      effectiveFrom: '1970-01-01T00:00:00.000Z',
    },
    {
      breakMode: 'automatic',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      secondStep: null,
      effectiveFrom: '2026-09-08T04:00:00.000Z',
    },
  ],
};

declare global {
  interface Window {
    /** What the `break-policy` read answers: the saved rule, or `null` for a failed read. */
    breakRuleWeekContract: { policy: BreakPolicy | null; policyReads: number };
  }
}
window.breakRuleWeekContract = { policy: MANUAL_WITHOUT_VERSIONS, policyReads: 0 };

/** The `break-policy` read: the rule the contract set, or a failure. */
export function readBreakRuleWeekPolicy():
  | { success: true; breakPolicy: BreakPolicy }
  | { success: false; error: string } {
  window.breakRuleWeekContract.policyReads += 1;
  const { policy } = window.breakRuleWeekContract;
  return policy ? { success: true, breakPolicy: policy } : { success: false, error: 'load_failed' };
}

function ZeiterfassungWeek({ breakPolicy, label }: { breakPolicy: BreakPolicy; label: string }) {
  const { weekData, todayIndex, weekLabel, weekTargets } = useWeeklyTimeData({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    breakPolicy,
  });
  return (
    <section aria-label={label}>
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

/**
 * The week of a page that stays open while another session saves the rule:
 * its server data never changes; the saved rule arrives only through the
 * week's own read after the organization_settings event.
 */
function ZeiterfassungWeekLive() {
  const { weekData, todayIndex, weekLabel, weekTargets, isStale } = useWeeklyTimeData({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    breakPolicy: MANUAL_WITHOUT_VERSIONS,
  });
  return (
    <section aria-label="Zeiterfassung live">
      <output aria-label="Wochenstand">{isStale ? 'veraltet' : 'aktuell'}</output>
      <WeeklyHoursChart
        weekData={weekData}
        todayIndex={todayIndex}
        weekLabel={weekLabel}
        weekTargets={weekTargets}
      />
    </section>
  );
}

/** The week of a page that stays open while another session saves the rule. */
function ZeiterfassungWeekAcrossASave() {
  const [breakPolicy, setBreakPolicy] = useState(MANUAL_WITHOUT_VERSIONS);
  return (
    <>
      <ZeiterfassungWeek breakPolicy={breakPolicy} label="Zeiterfassung offen" />
      <button
        type="button"
        onClick={() => {
          // The server render and the week's own read both answer the saved rule.
          window.breakRuleWeekContract.policy = SAVED_ON_TUESDAY;
          setBreakPolicy(SAVED_ON_TUESDAY);
        }}
      >
        Neue Regel übernehmen
      </button>
    </>
  );
}

export function BreakRuleWeekFixture() {
  return (
    <RealtimeProvider>
      <ZeiterfassungWeek breakPolicy={RULE_CHANGED_ON_TUESDAY} label="Zeiterfassung" />
      <MitarbeiterDetailWeek />
      <ZeiterfassungWeekAcrossASave />
      <ZeiterfassungWeekLive />
    </RealtimeProvider>
  );
}
