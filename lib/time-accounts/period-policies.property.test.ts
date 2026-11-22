import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  expectedVersionOn,
  monthDatesOf,
  PERIOD_ORGANIZATION,
  periodWorldArbitrary,
  seedPeriodWorld,
  workforceOf,
} from '@/lib/testing/fixtures/period-preparation-world';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Time accounts": each organization has one versioned default policy, plus optional
// employee-specific policies, and a day follows the policy version with the latest start on or
// before it. A person's own policy applies on the days its assignment covers.

// The world fixture stubs `server-only` and the service-role client first.
const { resolvePoliciesForPeriod } = await import('./period-policies');

describe('The policy calendar of a period', () => {
  test('gives each day the latest started version of the person’s assigned policy, else of the default', async () => {
    await fc.assert(
      fc.asyncProperty(periodWorldArbitrary, async (world) => {
        seedPeriodWorld(world);
        const people = workforceOf(world);
        const calendar = await resolvePoliciesForPeriod(
          PERIOD_ORGANIZATION,
          world.month.start,
          world.month.end,
          people.map((employee) => employee.id),
        );
        const dates = monthDatesOf(world.month);
        for (const employee of people)
          expect(dates.map((date) => calendar.get(employee.id)?.get(date)?.id ?? null)).toEqual(
            dates.map((date) => expectedVersionOn(world, employee, date)),
          );
      }),
    );
  });
});
