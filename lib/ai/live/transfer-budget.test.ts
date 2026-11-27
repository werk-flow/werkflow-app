// Rule test: the WerkFlow KI transfer budget (check 1 of werk-flow/werkflow-planning#20,
// werk-flow/werkflow-planning#532). lib/testing/fixtures/ki-transfer-budget.ts runs a fixed,
// synthetic, heavy thread through the real route, reader, live broadcast and follow logic and
// measures what each flow costs. Each number has a ceiling beside the value measured when it was
// set. A run over a ceiling fails. Ceilings only fall: TRANSFER_CEILINGS is a shrink-only list
// (lib/testing/publication/shrink-only-lists.ts), so CI refuses a raised one, and a change of
// TRANSFER_MEASURED shows the comparison with main in the diff.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { z } from '@/lib/zod';

type Metric = 'bytes' | 'rows' | 'messages';
type Flow =
  | 'thread open'
  | 'live turn, sending tab'
  | 'live turn, other tab'
  | 'resume after reload'
  | 'idle reconnect';

/**
 * Measured at the commit that set the ceilings, on the fixture's thread: 60 turns, 40 shown, and
 * answers of 60 parts 25 ms apart (lib/ai/replay.ts, `langsam`).
 * Bytes are what the client receives (JSON of each response, stream line and live event, the sending
 * tab's own copy of its turn and the first join's catch-up included), rows what the database
 * returned, messages the responses, stream lines and live events.
 */
const TRANSFER_MEASURED: Readonly<Record<Flow, Readonly<Record<Metric, number>>>> = {
  'thread open': { bytes: 39_953, rows: 43, messages: 2 },
  'live turn, sending tab': { bytes: 8_179, rows: 21, messages: 39 },
  'live turn, other tab': { bytes: 4_182, rows: 0, messages: 9 },
  'resume after reload': { bytes: 46_452, rows: 46, messages: 10 },
  'idle reconnect': { bytes: 58, rows: 1, messages: 1 },
};

const TRANSFER_CEILINGS: Readonly<Record<Flow, Readonly<Record<Metric, number>>>> = {
  'thread open': { bytes: 44_000, rows: 43, messages: 2 },
  'live turn, sending tab': { bytes: 9_000, rows: 24, messages: 42 },
  'live turn, other tab': { bytes: 4_600, rows: 0, messages: 10 },
  'resume after reload': { bytes: 51_000, rows: 50, messages: 11 },
  'idle reconnect': { bytes: 64, rows: 1, messages: 1 },
};

const measureSchema = z.object({ bytes: z.number(), rows: z.number(), messages: z.number() });
const reportSchema = z.record(z.string(), measureSchema);

async function measure(): Promise<z.infer<typeof reportSchema>> {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../../testing/fixtures/ki-transfer-budget.ts')],
    {
      cwd: resolve(import.meta.dir, '../../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
  const line = stdout.split('\n').find((entry) => entry.startsWith('TRANSFER '));
  expect(line, 'the fixture must print its measurements').toBeDefined();
  return reportSchema.parse(JSON.parse(line?.slice('TRANSFER '.length) ?? '{}'));
}

test('thread open, a live turn, resume after a reload and an idle reconnect stay within their transfer ceilings', async () => {
  const report = await measure();
  const rows: string[] = [];
  const over: string[] = [];
  for (const [flow, ceilings] of Object.entries(TRANSFER_CEILINGS)) {
    const actual = report[flow];
    expect(actual, `the fixture must measure "${flow}"`).toBeDefined();
    for (const metric of ['bytes', 'rows', 'messages'] as const) {
      const value = actual?.[metric] ?? Number.POSITIVE_INFINITY;
      const recorded = Object.entries(TRANSFER_MEASURED).find(([name]) => name === flow)?.[1][metric];
      rows.push(`${flow} ${metric}: ${value} (recorded ${recorded ?? '-'}, ceiling ${ceilings[metric]})`);
      if (value > ceilings[metric]) over.push(`${flow} ${metric}: ${value} > ${ceilings[metric]}`);
    }
  }
  process.stdout.write(`${rows.join('\n')}\n`);
  expect(over, 'a flow sent more than its ceiling; find the cause, never raise the ceiling').toEqual([]);
});
