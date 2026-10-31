// The in-memory admin answers like PostgREST: a filter on a dotted column of a
// seeded embedded array drops that embed's items, never its parent row.
import { expect, test } from 'bun:test';
import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';

const DAY_START = '2026-10-26T23:00:00.000Z';
const DAY_END = '2026-10-27T22:59:59.999Z';

function sessions(): InMemoryTables {
  return {
    time_sessions: [
      {
        id: 'session',
        time_segments: [
          { id: 'yesterday', started_at: '2026-10-26T21:00:00.000Z', ended_at: '2026-10-26T22:30:00.000Z' },
          { id: 'overnight', started_at: '2026-10-26T22:30:00.000Z', ended_at: '2026-10-26T23:30:00.000Z' },
          { id: 'today', started_at: '2026-10-27T08:00:00.000Z', ended_at: '2026-10-27T09:00:00.000Z' },
          { id: 'running', started_at: '2026-10-27T09:00:00.000Z', ended_at: null },
          { id: 'tomorrow', started_at: '2026-10-28T07:00:00.000Z', ended_at: '2026-10-28T08:00:00.000Z' },
        ],
      },
    ],
  };
}

test('range and referenced-table or filters keep only the embedded items of the day', async () => {
  const { data } = await createInMemoryAdmin(sessions())
    .from('time_sessions')
    .select('id, time_segments(*)')
    .lte('time_segments.started_at', DAY_END)
    .or(`ended_at.is.null,ended_at.gte.${DAY_START}`, { referencedTable: 'time_segments' });

  expect(Array.isArray(data) ? data.map((row) => row.id) : data).toEqual(['session']);
  const segments = Array.isArray(data) ? data[0]?.time_segments : undefined;
  expect(Array.isArray(segments) ? segments.map((segment: { id: string }) => segment.id) : segments).toEqual([
    'overnight',
    'today',
    'running',
  ]);
});

test('an embedded filter leaves the seeded rows untouched', async () => {
  const tables = sessions();
  await createInMemoryAdmin(tables)
    .from('time_sessions')
    .select('id, time_segments(*)')
    .gte('time_segments.started_at', DAY_START);

  const seeded = tables.time_sessions?.[0]?.time_segments;
  expect(Array.isArray(seeded) ? seeded.length : seeded).toBe(5);
});

test('a !inner embed keeps its parent only while an embedded row passes every filter', async () => {
  const admin = createInMemoryAdmin(sessions());
  const cutoff = await admin
    .from('time_sessions')
    .select('id, time_segments!inner(*)')
    .gte('time_segments.started_at', '2026-10-29T00:00:00.000Z')
    .or('ended_at.is.null', { referencedTable: 'time_segments' });
  expect(cutoff.data).toEqual([]);

  const matching = await admin
    .from('time_sessions')
    .select('id, time_segments!inner(*)')
    .eq('time_segments.id', 'today');
  const segments = Array.isArray(matching.data) ? matching.data[0]?.time_segments : undefined;
  expect(Array.isArray(segments) ? segments.map((segment: { id: string }) => segment.id) : segments).toEqual([
    'today',
  ]);
});
