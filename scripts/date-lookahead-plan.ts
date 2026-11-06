import { appendFileSync } from 'node:fs';
import { getBusinessTodayIso } from '../lib/date-time/berlin';
import { askedDay, failedBrowserDates, lookaheadDays, lookaheadLegs } from '../lib/testing/date-lookahead';
import { z } from '../lib/zod';

// The `Plan` job of .github/workflows/date-lookahead.yml: which dates this run looks at, as one matrix.
// SHARDS and SQL are the outputs of scripts/ci-plan.ts --full; OPEN_ALERT is the body of the open alert
// issue, if any; ASKED_DATE narrows the run to one date. It writes `legs` to $GITHUB_OUTPUT.
const input = z
  .object({
    SHARDS: z.string(),
    SQL: z.string().min(1),
    OPEN_ALERT: z.string().default(''),
    ASKED_DATE: z.union([z.literal(''), z.iso.date()]).default(''),
    GITHUB_OUTPUT: z.string().min(1),
  })
  .parse(process.env);
const shards = z.array(z.object({ shard: z.number(), groups: z.string() })).parse(JSON.parse(input.SHARDS));

const days = input.ASKED_DATE
  ? [askedDay(input.ASKED_DATE)]
  : lookaheadDays(getBusinessTodayIso(), failedBrowserDates(input.OPEN_ALERT));
const legs = lookaheadLegs(days, { sql: input.SQL, shards });
for (const leg of legs) console.info(`  ${leg.name} at ${leg.instant}`);
appendFileSync(input.GITHUB_OUTPUT, `legs=${JSON.stringify(legs)}\n`);
