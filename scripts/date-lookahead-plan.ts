import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { getBusinessTodayIso } from '../lib/date-time/berlin';
import {
  agentHosts,
  askedDay,
  browserLegFits,
  failedBrowserDates,
  lookaheadDays,
  lookaheadLegs,
} from '../lib/testing/date-lookahead';
import { z } from '../lib/zod';

// The `Plan` job of .github/workflows/date-lookahead.yml: which dates this run looks at, as one matrix.
// SHARDS and SQL are the outputs of scripts/ci-plan.ts --full; OPEN_ALERT is the body of the open alert
// issue, if any; ASKED_DATE narrows the run to one date. It writes `legs` to $GITHUB_OUTPUT. It runs on
// a GitHub-hosted runner: it reads the runner agent's journal to learn how far a leg may shift its clock.
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

function certificateExpiry(host: string): Date {
  const chain = execFileSync('openssl', ['s_client', '-connect', `${host}:443`, '-servername', host], {
    encoding: 'utf8',
    input: '',
    // Its progress goes to stderr; a failure carries it in the thrown error.
    stdio: 'pipe',
    timeout: 10_000,
  });
  const notAfter = execFileSync('openssl', ['x509', '-noout', '-enddate'], {
    encoding: 'utf8',
    input: chain,
  });
  const expiry = new Date(notAfter.replace(/^notAfter=/, '').trim());
  if (Number.isNaN(expiry.getTime()))
    throw new Error(`${host} sent a certificate without a readable expiry.`);
  return expiry;
}

const journal = execFileSync(
  'sudo',
  ['journalctl', '--unit', 'hosted-compute-agent', '--output', 'cat', '--no-pager'],
  {
    encoding: 'utf8',
  },
);
const hosts = agentHosts(journal);
if (hosts.length === 0)
  throw new Error(
    "The runner agent's journal names no host, so the plan cannot tell how far a leg may shift its clock.",
  );
const expiries = hosts.map(certificateExpiry);
const expiry = new Date(Math.min(...expiries.map((date) => date.getTime())));
console.info(`The runner agent's certificates (${hosts.join(', ')}) expire ${expiry.toISOString()}.`);

const days = input.ASKED_DATE
  ? [askedDay(input.ASKED_DATE)]
  : lookaheadDays(getBusinessTodayIso(), failedBrowserDates(input.OPEN_ALERT));
const legs = lookaheadLegs(days, { sql: input.SQL, shards, certificateExpiry: expiry });
for (const leg of legs) console.info(`  ${leg.name} at ${leg.instant}`);
for (const day of days.filter((day) => day.browser && !browserLegFits(day, expiry)))
  console.info(
    `  ${day.date} ${day.label}: no browser groups; the runner would be shut down past the expiry`,
  );
appendFileSync(input.GITHUB_OUTPUT, `legs=${JSON.stringify(legs)}\n`);
