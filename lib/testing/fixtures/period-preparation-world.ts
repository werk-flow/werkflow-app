import { mock } from 'bun:test';
import fc from 'fast-check';
import { EMPTY_HOLIDAY_CALENDAR } from '@/lib/personnel/targets';
import { berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { type BerlinMonth, berlinMonth, yearMonthArbitrary } from '@/lib/testing/time-account-arbitraries';
import { createInMemoryAdmin, type InMemoryTables } from './in-memory-admin';

/**
 * One organization's month for the period preparation (lib/time-accounts/period-preparation.ts)
 * and the two server modules it reads through: people with and without a login, their entry and
 * exit dates, Zeitkonto openings and signed account events, a default policy and employee
 * policies with dated versions and assignments. The rows live in the in-memory admin, which
 * applies the filters each read sends; absences and the holiday calendar stay empty.
 *
 * The oracles below state docs/features/time-tracking.md, "Time accounts" and "Period close":
 * a period covers everyone employed in its month; a day follows the version with the latest start
 * on or before it of the person's own policy where one is assigned, else of the default policy;
 * the opening balance of a month is the sum of the account events before it.
 */

export const PERIOD_ORGANIZATION = 'org-1';
const OTHER_ORGANIZATION = 'org-2';
const DAY_MS = 86_400_000;

const MANUAL_EVENT_KINDS = ['opening_balance', 'manual_adjustment', 'expiry', 'payout'] as const;
const EVENT_KINDS = [...MANUAL_EVENT_KINDS, 'period_close', 'period_reopen_reversal'] as const;
const EMPLOYEE_POLICIES = ['policy-own-1', 'policy-own-2'] as const;
const DEFAULT_POLICY = 'policy-default';

type AccountEvent = { effectiveDate: string; kind: (typeof EVENT_KINDS)[number]; minutes: number };
type Assignment = { policyId: string; validFrom: string; validUntil: string | null };

type WorldEmployee = {
  id: string;
  userId: string | null;
  entryDate: string | null;
  exitDate: string | null;
  accountOpenedOn: string | null;
  events: AccountEvent[];
  assignments: Assignment[];
};

export type PeriodWorld = {
  month: BerlinMonth;
  employees: WorldEmployee[];
  /** The start dates of the default policy's versions; null when the organization has none. */
  defaultVersionStarts: string[] | null;
  /** The start dates of each employee policy's versions; each has one in force from 2000 on. */
  employeePolicyVersionStarts: Record<(typeof EMPLOYEE_POLICIES)[number], string[]>;
};

const addDays = (localDate: string, days: number): string =>
  new Date(Date.parse(`${localDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Every date of a month. */
export function monthDatesOf(month: BerlinMonth): string[] {
  const dates: string[] = [];
  for (let date = month.start; date <= month.end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** The instants the preparation takes: the month's first and the next month's first Berlin midnight. */
export function periodInstants(month: BerlinMonth): { startInstant: string; endInstant: string } {
  return {
    startInstant: new Date(berlinMidnightMs(month.start)).toISOString(),
    endInstant: new Date(berlinMidnightMs(month.endExclusive)).toISOString(),
  };
}

/** A date before, inside or after the month, its first and last days and the days around them often. */
const dateAround = (month: BerlinMonth): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constantFrom(
      addDays(month.start, -40),
      addDays(month.start, -1),
      month.start,
      month.end,
      month.endExclusive,
      addDays(month.end, 40),
    ),
    fc.integer({ min: 1, max: 26 }).map((day) => addDays(month.start, day)),
  );

const eventArbitrary = (month: BerlinMonth): fc.Arbitrary<AccountEvent> =>
  fc
    .record({
      effectiveDate: dateAround(month),
      kind: fc.constantFrom(...EVENT_KINDS),
      manualKind: fc.constantFrom(...MANUAL_EVENT_KINDS),
      minutes: fc.integer({ min: -6_000, max: 6_000 }),
    })
    // Inside the month only the manual events occur; a close posts at the month's end or later.
    .map(({ effectiveDate, kind, manualKind, minutes }) => ({
      effectiveDate,
      kind: effectiveDate >= month.start && effectiveDate <= month.end ? manualKind : kind,
      minutes,
    }));

/** Up to two assignments that never overlap, the last one possibly open-ended. */
const assignmentsArbitrary = (month: BerlinMonth): fc.Arbitrary<Assignment[]> =>
  fc
    .record({
      bounds: fc.uniqueArray(dateAround(month), { maxLength: 4 }),
      policies: fc.array(fc.constantFrom(...EMPLOYEE_POLICIES), { minLength: 2, maxLength: 2 }),
      openEnd: fc.boolean(),
    })
    .map(({ bounds, policies, openEnd }) => {
      const sorted = [...bounds].sort();
      const assignments: Assignment[] = [];
      for (let index = 0; index + 1 < sorted.length; index += 2)
        assignments.push({
          policyId: policies[index / 2] ?? DEFAULT_POLICY,
          validFrom: sorted[index] ?? month.start,
          validUntil: sorted[index + 1] ?? null,
        });
      const last = assignments.at(-1);
      if (last && openEnd) last.validUntil = null;
      return assignments;
    });

const employeeArbitrary = (
  month: BerlinMonth,
): fc.Arbitrary<Omit<WorldEmployee, 'id' | 'userId'> & { hasLogin: boolean }> =>
  fc
    .record({
      hasLogin: fc.boolean(),
      employment: fc.array(fc.option(dateAround(month), { nil: null }), { minLength: 2, maxLength: 2 }),
      accountOpenedOn: fc.option(dateAround(month), { nil: null }),
      events: fc.array(eventArbitrary(month), { maxLength: 5 }),
      assignments: assignmentsArbitrary(month),
    })
    .map(({ hasLogin, employment: [first = null, second = null], accountOpenedOn, events, assignments }) => {
      const [entryDate, exitDate] = first && second && second < first ? [second, first] : [first, second];
      return {
        hasLogin,
        entryDate,
        exitDate,
        accountOpenedOn,
        // Account events exist only on an opened account.
        events: accountOpenedOn ? events : [],
        assignments,
      };
    });

const versionStartsArbitrary = (month: BerlinMonth): fc.Arbitrary<string[]> =>
  fc.uniqueArray(dateAround(month), { minLength: 1, maxLength: 3 });

export const periodWorldArbitrary: fc.Arbitrary<PeriodWorld> = yearMonthArbitrary.chain(({ year, month }) => {
  const period = berlinMonth(year, month);
  return fc.record({
    month: fc.constant(period),
    employees: fc.array(employeeArbitrary(period), { minLength: 1, maxLength: 4 }).map((drafts) =>
      drafts.map(({ hasLogin, ...employee }, index) => ({
        ...employee,
        id: `record-${index}`,
        userId: hasLogin ? `user-${index}` : null,
      })),
    ),
    defaultVersionStarts: fc.option(versionStartsArbitrary(period), { nil: null }),
    employeePolicyVersionStarts: fc.record({
      'policy-own-1': versionStartsArbitrary(period).map((starts) => ['2000-01-01', ...starts]),
      'policy-own-2': versionStartsArbitrary(period).map((starts) => ['2000-01-01', ...starts]),
    }),
  });
});

const versionId = (policyId: string, start: string): string => `${policyId}@${start}`;

function versionStartsOf(world: PeriodWorld, policyId: string): string[] {
  if (policyId === DEFAULT_POLICY) return world.defaultVersionStarts ?? [];
  return EMPLOYEE_POLICIES.flatMap((id) => (id === policyId ? world.employeePolicyVersionStarts[id] : []));
}

/** The people employed on some day of the month, with or without a login. */
export function workforceOf(world: PeriodWorld): WorldEmployee[] {
  return world.employees.filter(
    (employee) =>
      (employee.entryDate === null || employee.entryDate <= world.month.end) &&
      (employee.exitDate === null || employee.exitDate >= world.month.start),
  );
}

/** The policy version a person's day follows, or null on a day without one. */
export function expectedVersionOn(world: PeriodWorld, employee: WorldEmployee, date: string): string | null {
  const assigned = employee.assignments.find(
    (assignment) =>
      assignment.validFrom <= date && (assignment.validUntil === null || date <= assignment.validUntil),
  );
  const policyId = assigned?.policyId ?? (world.defaultVersionStarts ? DEFAULT_POLICY : null);
  if (!policyId) return null;
  const latestStart = versionStartsOf(world, policyId)
    .filter((start) => start <= date)
    .sort()
    .at(-1);
  return latestStart ? versionId(policyId, latestStart) : null;
}

/** The sum of a person's account events in a date range, both ends inclusive. */
export const eventMinutesBetween = (employee: WorldEmployee, from: string, until: string): number =>
  employee.events
    .filter((event) => from <= event.effectiveDate && event.effectiveDate <= until)
    .reduce((sum, event) => sum + event.minutes, 0);

/** The people, accounts and account events of the world, and one person of another organization. */
function peopleTablesOf(world: PeriodWorld): InMemoryTables {
  const organization_id = PERIOD_ORGANIZATION;
  const foreign = { id: 'record-foreign', organization_id: OTHER_ORGANIZATION };
  return {
    employee_records: [
      ...world.employees.map((employee) => ({
        id: employee.id,
        organization_id,
        user_id: employee.userId,
        entry_date: employee.entryDate,
        exit_date: employee.exitDate,
      })),
      { ...foreign, user_id: null, entry_date: null, exit_date: null },
    ],
    time_accounts: [
      ...world.employees.flatMap((employee) =>
        employee.accountOpenedOn
          ? [
              {
                id: `account-${employee.id}`,
                organization_id,
                employee_record_id: employee.id,
                opened_on: employee.accountOpenedOn,
              },
            ]
          : [],
      ),
      {
        id: 'account-foreign',
        organization_id: OTHER_ORGANIZATION,
        employee_record_id: foreign.id,
        opened_on: '2000-01-01',
      },
    ],
    time_account_events: [
      ...world.employees.flatMap((employee) =>
        employee.events.map((event, index) => ({
          id: `event-${employee.id}-${index}`,
          organization_id,
          account_id: `account-${employee.id}`,
          employee_record_id: employee.id,
          effective_date: event.effectiveDate,
          event_kind: event.kind,
          minutes: event.minutes,
        })),
      ),
      {
        id: 'event-foreign',
        organization_id: OTHER_ORGANIZATION,
        account_id: 'account-foreign',
        employee_record_id: foreign.id,
        effective_date: '2000-01-01',
        event_kind: 'opening_balance',
        minutes: 600,
      },
    ],
  };
}

/** The policies of the world, their dated versions and the people's assignments. */
function policyTablesOf(world: PeriodWorld): InMemoryTables {
  const organization_id = PERIOD_ORGANIZATION;
  const policyIds = [...(world.defaultVersionStarts ? [DEFAULT_POLICY] : []), ...EMPLOYEE_POLICIES];
  return {
    time_account_policies: policyIds.map((id) => ({
      id,
      organization_id,
      is_default: id === DEFAULT_POLICY,
      retired_at: null,
    })),
    time_account_policy_versions: policyIds.flatMap((policyId) =>
      [...versionStartsOf(world, policyId)].sort().map((start, index) => ({
        id: versionId(policyId, start),
        organization_id,
        policy_id: policyId,
        version: index + 1,
        effective_from: start,
        night_window_start: null,
        night_window_end: null,
        vacation_treatment: 'paid',
        sickness_treatment: 'paid',
      })),
    ),
    time_account_policy_assignments: world.employees.flatMap((employee) =>
      employee.assignments.map((assignment, index) => ({
        id: `assignment-${employee.id}-${index}`,
        organization_id,
        employee_record_id: employee.id,
        policy_id: assignment.policyId,
        valid_from: assignment.validFrom,
        valid_until: assignment.validUntil,
      })),
    ),
  };
}

let seeded: InMemoryTables = {};

/** Puts the world's rows behind the service-role client the period modules create or receive. */
export function seedPeriodWorld(world: PeriodWorld): void {
  seeded = { ...peopleTablesOf(world), ...policyTablesOf(world) };
}

// The period modules are server-only and read the calendar and absences through cached and
// server readers; as in lib/planning/daily-targets-batching.test.ts, the stubs answer an empty
// calendar and no absences, and the service-role client is the in-memory admin over the world.
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => createInMemoryAdmin(seeded) }));
mock.module('@/lib/data/cached', () => ({
  getCachedOrganizationCalendar: async () => EMPTY_HOLIDAY_CALENDAR,
}));
mock.module('@/lib/vacation/server', () => ({ loadApprovedVacationSpansByRecord: async () => new Map() }));
mock.module('@/lib/sickness/server', () => ({ loadActiveSicknessSpansByRecord: async () => new Map() }));
mock.module('@/lib/personnel/school-day-server', () => ({
  loadSchoolDaySpansByRecord: async () => new Map(),
}));
