import { expect, mock, test } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import type { ApprovedAbsenceSpan } from '@/lib/personnel/targets';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import type { TimeAccountPolicy } from './types';

// The period review's Berufsschule minutes (werk-flow/werkflow-planning#165)
// must match what the preparation counts: a vacation or sickness that the
// policy treats as informational does not relieve a school day, so the day
// still credits its normal target as school.

const APPRENTICE = 'apprentice-1';
const SCHOOL_FRIDAY = '2026-11-06';
const fullDay = (type: ApprovedAbsenceSpan['type']): ApprovedAbsenceSpan => ({
  type,
  startDate: SCHOOL_FRIDAY,
  endDate: SCHOOL_FRIDAY,
  dayPortion: 'full',
});

let vacationSpans: ApprovedAbsenceSpan[] = [];
let treatment: TimeAccountPolicy['vacationTreatment'] = 'paid';

mock.module('server-only', () => ({}));
mock.module('@/lib/data/cached', () => ({
  getCachedOrganizationCalendar: async () => ({
    holidayRegion: null,
    holidayRegionHistory: [],
    closureDays: [],
  }),
}));
mock.module('@/lib/personnel/school-day-server', () => ({
  loadSchoolDaySpansByRecord: async () => new Map([[APPRENTICE, [fullDay('school')]]]),
}));
mock.module('@/lib/vacation/server', () => ({
  loadApprovedVacationSpansByRecord: async () => new Map([[APPRENTICE, vacationSpans]]),
}));
mock.module('@/lib/sickness/server', () => ({
  loadActiveSicknessSpansByRecord: async () => new Map(),
}));
mock.module('./period-policies', () => ({
  resolvePoliciesForPeriod: async () =>
    new Map([
      [
        APPRENTICE,
        new Map([
          [
            SCHOOL_FRIDAY,
            {
              id: 'policy-1',
              version: 1,
              effectiveFrom: '2026-01-01',
              vacationTreatment: treatment,
              sicknessTreatment: treatment,
              warningRules: [],
              nightWindow: null,
              creditRules: [],
              supplementRules: [],
            },
          ],
        ]),
      ],
    ]),
}));

const { readPeriodSchoolMinutes } = await import('./period-school-minutes');

const SCHEDULE = {
  id: 'schedule-1',
  organization_id: 'org',
  employee_record_id: APPRENTICE,
  valid_from: '2026-01-01',
  monday_minutes: 480,
  tuesday_minutes: 480,
  wednesday_minutes: 480,
  thursday_minutes: 480,
  friday_minutes: 480,
  saturday_minutes: 0,
  sunday_minutes: 0,
  note: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** A real admin client over a PostgREST stand-in that answers each table's rows. */
function admin(): AdminClient {
  const rowsByTable: Record<string, unknown[]> = {
    employee_records: [{ id: APPRENTICE, entry_date: null, exit_date: null }],
    work_schedules: [SCHEDULE],
    employment_conditions: [],
  };
  return createClient<Database>('http://127.0.0.1:54321', 'isolated-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          );
          return Response.json(rowsByTable[url.pathname.split('/').at(-1) ?? ''] ?? []);
        },
        { preconnect: fetch.preconnect },
      ),
    },
  });
}

async function schoolMinutes(): Promise<number | undefined> {
  const minutes = await readPeriodSchoolMinutes(
    admin(),
    'org',
    { start: SCHOOL_FRIDAY, end: SCHOOL_FRIDAY },
    [APPRENTICE],
  );
  return minutes.get(APPRENTICE);
}

test('a school day credits its normal target as school minutes', async () => {
  vacationSpans = [];
  expect(await schoolMinutes()).toBe(480);
});

test('a paid vacation on a school day credits the day as vacation, not as school', async () => {
  vacationSpans = [fullDay('vacation')];
  treatment = 'paid';
  expect(await schoolMinutes()).toBeUndefined();
});

test('an informational vacation on a school day leaves the school minutes the preparation counts', async () => {
  vacationSpans = [fullDay('vacation')];
  treatment = 'informational';
  expect(await schoolMinutes()).toBe(480);
});
