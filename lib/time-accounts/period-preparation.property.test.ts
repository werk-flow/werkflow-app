import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays } from '@/lib/date-time/berlin';
import {
  eventMinutesBetween,
  expectedVersionOn,
  inOwnPeriodProcess,
  monthDatesOf,
  PERIOD_ORGANIZATION,
  type PeriodWorld,
  periodInstants,
  periodWorldArbitrary,
  seedPeriodWorld,
  workforceOf,
} from '@/lib/testing/fixtures/period-preparation-world';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Period close" and "Time accounts": a period covers the whole workforce of its month, people
// without a login included; it opens each person's month with the balance of the account events
// before it; a person's own policy overrides the default where assigned; a missing policy or
// account blocks the close for that person instead of counting as zero.

// The properties run in a `bun test` process of their own, where the world fixture stubs the
// readers behind the module first (inOwnPeriodProcess).
const ownProcess = inOwnPeriodProcess(import.meta.path);
const { buildTimePeriodPreparation } = await import('./period-preparation');
const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');

async function prepare(world: PeriodWorld) {
  seedPeriodWorld(world);
  return buildTimePeriodPreparation({
    admin: createSupabaseAdminClient(),
    context: { orgId: PERIOD_ORGANIZATION },
    bounds: world.month,
    ...periodInstants(world.month),
  });
}

const SETUP_BLOCKERS = new Set(['missing_policy', 'missing_opening_balance']);

if (ownProcess)
  describe('The preparation of a period', () => {
    test('gives everyone employed in the month one result with its policy, opening balance, events and blockers', async () => {
      await fc.assert(
        fc.asyncProperty(periodWorldArbitrary, async (world) => {
          const { employeePayload, findingPayload } = await prepare(world);
          const people = workforceOf(world);
          expect(employeePayload.map((row) => row.employee_record_id).sort()).toEqual(
            people.map((employee) => employee.id).sort(),
          );
          const dates = monthDatesOf(world.month);
          const dayBefore = addLocalDays(world.month.start, -1);
          for (const employee of people) {
            const row = employeePayload.find((result) => result.employee_record_id === employee.id);
            // The month opens with every account event before it, whatever its kind.
            expect(row?.previous_balance_minutes).toBe(
              eventMinutesBetween(employee, '0000-01-01', dayBefore),
            );
            // The person's own policy where assigned, else the default, in force at the month end.
            expect(row?.policy_version_id).toBe(expectedVersionOn(world, employee, world.month.end));
            const blockers = findingPayload.filter(
              (finding) =>
                finding.employee_record_id === employee.id &&
                SETUP_BLOCKERS.has(String(finding.finding_kind)),
            );
            for (const blocker of blockers) expect(blocker.severity).toBe('close_blocked');
            const kinds = blockers.map((finding) => finding.finding_kind);
            const policyMissing = dates.some((date) => expectedVersionOn(world, employee, date) === null);
            expect(kinds.includes('missing_policy')).toBe(policyMissing);
            const opened = employee.accountOpenedOn;
            const accountMissing = opened === null || opened > world.month.end;
            // An account opened after the month's first day: the specs do not say whether it blocks.
            if (accountMissing || opened <= world.month.start)
              expect(kinds.includes('missing_opening_balance')).toBe(accountMissing);
            if (blockers.length > 0) continue;
            // A computed month counts its own account events and closes on its change.
            expect(row?.account_event_minutes).toBe(
              eventMinutesBetween(employee, world.month.start, world.month.end),
            );
            expect(row?.closing_balance_minutes).toBe(
              Number(row?.previous_balance_minutes) + Number(row?.period_delta_minutes),
            );
          }
        }),
      );
    });
  });
