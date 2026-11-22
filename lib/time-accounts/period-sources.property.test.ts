import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import {
  inOwnPeriodProcess,
  monthDatesOf,
  PERIOD_ORGANIZATION,
  periodInstants,
  periodWorldArbitrary,
  seedPeriodWorld,
  workforceOf,
} from '@/lib/testing/fixtures/period-preparation-world';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Period close" and "Time accounts": a period is one organization-wide calendar month in
// Europe/Berlin and covers everyone employed in its month, people without a login included.

// The properties run in a `bun test` process of their own, where the world fixture stubs the
// readers behind the module first (inOwnPeriodProcess).
const ownProcess = inOwnPeriodProcess(import.meta.path);
const { loadIndexedPeriodSources } = await import('./period-sources');
const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');

if (ownProcess)
  describe('The indexed sources of a period', () => {
    test('hold everyone employed in the month, with or without a login, over the month’s Berlin days', async () => {
      await fc.assert(
        fc.asyncProperty(periodWorldArbitrary, async (world) => {
          seedPeriodWorld(world);
          const { index } = await loadIndexedPeriodSources({
            admin: createSupabaseAdminClient(),
            context: { orgId: PERIOD_ORGANIZATION },
            bounds: world.month,
            ...periodInstants(world.month),
          });
          expect(index.periodEmployees.map((employee) => employee.id).sort()).toEqual(
            workforceOf(world)
              .map((employee) => employee.id)
              .sort(),
          );
          // Each day of the month runs from its Berlin midnight to the next.
          const dates = monthDatesOf(world.month);
          expect(index.dates).toEqual(dates);
          expect(dates.map((date) => index.dateBounds.get(date))).toEqual(
            dates.map((date, day) => ({
              start: berlinMidnightMs(date),
              end: berlinMidnightMs(dates[day + 1] ?? world.month.endExclusive),
            })),
          );
        }),
      );
    });
  });
