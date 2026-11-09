import { describe, expect, test } from 'bun:test';

import {
  buildTimelineFacts,
  editTimelineRow,
  insertBreakIntoRow,
  newTimelineRow,
  resolveCorrectionTimeline,
  timelineRowsFromVisits,
  type CorrectionTimelineRow,
} from './timeline';

const JOB = '40000000-0000-4000-8000-000000000001';
const RECORD = '50000000-0000-4000-8000-000000000001';

function rows(...values: Array<Partial<Omit<CorrectionTimelineRow, 'key'>>>): CorrectionTimelineRow[] {
  return values.map((value, index) => newTimelineRow(`row-${index}`, value));
}

function facts(dateIso: string, timeline: CorrectionTimelineRow[]) {
  const resolved = resolveCorrectionTimeline(dateIso, timeline);
  if (!resolved.valid) throw new Error(JSON.stringify(resolved.errors));
  return buildTimelineFacts(resolved.segments, RECORD).map((fact) => [
    fact.entryType,
    fact.timestamp,
    fact.activity.kind,
    fact.jobId,
  ]);
}

describe('a forgotten day as one timeline', () => {
  test('work, a break and travel become the facts live capture records, in Berlin time', () => {
    const timeline = rows(
      {
        kind: 'travel',
        start: '06:30',
        end: '07:00',
        jobId: JOB,
        travelRoute: 'company_to_site',
        travelRole: 'driver',
      },
      { kind: 'work', start: '07:00', end: '12:00', jobId: JOB },
      { kind: 'break', start: '12:00', end: '12:30' },
      { kind: 'work', start: '12:30', end: '15:30', jobId: JOB },
    );
    expect(facts('2026-10-26', timeline)).toEqual([
      ['clock_in', '2026-10-26T05:30:00.000Z', 'travel', JOB],
      ['clock_out', '2026-10-26T06:00:00.000Z', 'travel', JOB],
      ['clock_in', '2026-10-26T06:00:00.000Z', 'work', JOB],
      ['break_start', '2026-10-26T11:00:00.000Z', 'break', null],
      ['break_end', '2026-10-26T11:30:00.000Z', 'work', JOB],
      ['clock_out', '2026-10-26T14:30:00.000Z', 'work', JOB],
    ]);
    const resolved = resolveCorrectionTimeline('2026-10-26', timeline);
    if (!resolved.valid) throw new Error('valid timeline refused');
    expect(buildTimelineFacts(resolved.segments, RECORD)[0]?.activity).toEqual({
      kind: 'travel',
      allocationKind: 'job',
      jobId: JOB,
      travelRoute: 'company_to_site',
      travelRole: 'driver',
    });
  });

  test('a time at or before the previous one ends on the next day, across midnight', () => {
    const timeline = rows(
      { kind: 'callout', start: '22:00', end: '23:30', jobId: JOB },
      { kind: 'break', start: '23:30', end: '00:15', endsNextDay: true },
      { kind: 'callout', start: '00:15', end: '01:30', jobId: JOB },
    );
    expect(facts('2026-10-20', timeline)).toEqual([
      ['clock_in', '2026-10-20T20:00:00.000Z', 'callout', JOB],
      ['break_start', '2026-10-20T21:30:00.000Z', 'break', null],
      ['break_end', '2026-10-20T22:15:00.000Z', 'callout', JOB],
      ['clock_out', '2026-10-20T23:30:00.000Z', 'callout', JOB],
    ]);
  });

  test('a gap between two activities clocks out and in again', () => {
    expect(
      facts('2026-10-26', rows({ start: '07:00', end: '11:00' }, { start: '13:00', end: '16:00' })),
    ).toEqual([
      ['clock_in', '2026-10-26T06:00:00.000Z', 'work', null],
      ['clock_out', '2026-10-26T10:00:00.000Z', 'work', null],
      ['clock_in', '2026-10-26T12:00:00.000Z', 'work', null],
      ['clock_out', '2026-10-26T15:00:00.000Z', 'work', null],
    ]);
  });

  test('an incomplete, overlapping or misplaced activity is marked on its field', () => {
    const resolved = resolveCorrectionTimeline(
      '2026-10-26',
      rows(
        { kind: 'break', start: '06:30', end: '07:00' },
        { start: '07:00', end: '' },
        { start: '10:00', end: '12:00' },
        { start: '11:00', end: '13:00' },
        { start: '14:00', end: '14:00' },
      ),
    );
    expect(resolved).toEqual({
      valid: false,
      errors: [
        { kind: 'Eine Pause liegt direkt zwischen zwei Tätigkeiten.' },
        { end: 'Bitte gib eine Uhrzeit an.' },
        {},
        { start: 'Die Tätigkeit beginnt vor dem Ende der vorherigen.' },
        { end: 'Das Ende muss nach dem Beginn liegen.' },
      ],
    });
  });

  test('an end before its start is refused unless the activity ends on the next day', () => {
    const resolved = resolveCorrectionTimeline('2026-10-26', rows({ start: '09:00', end: '08:00' }));
    expect(resolved.valid ? [] : resolved.errors).toEqual([
      {
        end: 'Das Ende liegt vor dem Beginn. Geht die Tätigkeit über Mitternacht, wähl „Endet am nächsten Tag“.',
      },
    ]);
    expect(
      resolveCorrectionTimeline('2026-10-26', rows({ start: '22:00', end: '06:00', endsNextDay: true }))
        .valid,
    ).toBe(true);
  });

  test('a timeline longer than 24 hours is refused on its last end', () => {
    const resolved = resolveCorrectionTimeline(
      '2026-10-20',
      rows({ start: '08:00', end: '07:00', endsNextDay: true }, { start: '07:00', end: '09:00' }),
    );
    expect(resolved.valid ? [] : resolved.errors).toEqual([
      {},
      { end: 'Ein Nachtrag umfasst höchstens 24 Stunden.' },
    ]);
  });

  test('a wall time the spring clock change skips is no time', () => {
    const resolved = resolveCorrectionTimeline('2026-03-29', rows({ start: '02:30', end: '06:00' }));
    expect(resolved.valid ? [] : resolved.errors).toEqual([
      { start: 'Diese Uhrzeit gibt es an dem Tag wegen der Zeitumstellung nicht.' },
    ]);
  });
});

describe('the rows a forgotten day starts from', () => {
  let counter = 0;
  const key = () => `key-${(counter += 1)}`;

  test('each planned visit is a work row with its job and Berlin times', () => {
    const {
      rows: [timed, allDay],
    } = timelineRowsFromVisits(
      [
        { jobId: JOB, startAt: '2026-10-26T06:00:00.000Z', endAt: '2026-10-26T14:30:00.000Z' },
        { jobId: JOB, startAt: null, endAt: null },
      ],
      key,
    );
    expect([timed?.kind, timed?.jobId, timed?.start, timed?.end]).toEqual(['work', JOB, '07:00', '15:30']);
    expect([allDay?.start, allDay?.end]).toEqual(['', '']);
  });

  test('without a planned visit, one empty work row', () => {
    expect(timelineRowsFromVisits([], key).rows.map((row) => [row.kind, row.start, row.end])).toEqual([
      ['work', '', ''],
    ]);
  });

  test('more planned visits than a timeline holds prefill nothing and say so', () => {
    const visits = Array.from({ length: 11 }, () => ({
      jobId: JOB,
      startAt: '2026-10-26T06:00:00.000Z',
      endAt: '2026-10-26T07:00:00.000Z',
    }));
    const prefill = timelineRowsFromVisits(visits, key);
    expect(prefill.overflow).toBe(true);
    expect(prefill.rows.map((row) => [row.start, row.end, row.jobId])).toEqual([['', '', null]]);
  });

  test('„Endet am nächsten Tag“ falls away once the end is after the start again', () => {
    const [night] = rows({ start: '22:00', end: '06:00', endsNextDay: true });
    if (!night) throw new Error('no row');
    expect(editTimelineRow(night, { end: '23:00' }).endsNextDay).toBe(false);
    expect(editTimelineRow(night, { start: '23:00' }).endsNextDay).toBe(true);
    const day = editTimelineRow(editTimelineRow(night, { start: '07:00' }), { end: '15:00' });
    expect(insertBreakIntoRow([day], day.key, key)?.map((row) => [row.start, row.end])).toEqual([
      ['07:00', '10:45'],
      ['10:45', '11:15'],
      ['11:15', '15:00'],
    ]);
    expect(insertBreakIntoRow(rows({ start: '09:00', end: '08:00' }), 'row-0', key)).toBeNull();
  });

  test('„Pause einfügen“ splits an activity around 30 minutes on a quarter hour', () => {
    const timeline = rows({ start: '07:00', end: '15:30', jobId: JOB });
    const split = insertBreakIntoRow(timeline, 'row-0', key);
    expect(split?.map((row) => [row.kind, row.start, row.end, row.jobId])).toEqual([
      ['work', '07:00', '11:00', JOB],
      ['break', '11:00', '11:30', null],
      ['work', '11:30', '15:30', JOB],
    ]);
    expect(insertBreakIntoRow(rows({ start: '07:00', end: '07:45' }), 'row-0', key)).toBeNull();
    expect(
      insertBreakIntoRow(rows({ kind: 'break', start: '07:00', end: '09:00' }), 'row-0', key),
    ).toBeNull();
  });

  test('„Pause einfügen“ on a night activity keeps its span: each part ends on the right day', () => {
    // 26.10.2026 is CET (UTC+1). Every split must resolve to the original row's span.
    const instants = (timeline: CorrectionTimelineRow[] | null) => {
      if (!timeline) throw new Error('no split');
      const resolved = resolveCorrectionTimeline('2026-10-26', timeline);
      if (!resolved.valid) throw new Error(JSON.stringify(resolved.errors));
      return resolved.segments.map((segment) => [
        segment.row.kind,
        segment.startedAt.toISOString(),
        segment.endedAt.toISOString(),
      ]);
    };
    // The break falls after midnight: only the first part crosses it.
    expect(
      instants(insertBreakIntoRow(rows({ start: '22:00', end: '06:00', endsNextDay: true }), 'row-0', key)),
    ).toEqual([
      ['work', '2026-10-26T21:00:00.000Z', '2026-10-27T00:45:00.000Z'],
      ['break', '2026-10-27T00:45:00.000Z', '2026-10-27T01:15:00.000Z'],
      ['work', '2026-10-27T01:15:00.000Z', '2026-10-27T05:00:00.000Z'],
    ]);
    // The break falls before midnight: the third part crosses it.
    expect(
      instants(insertBreakIntoRow(rows({ start: '20:00', end: '01:00', endsNextDay: true }), 'row-0', key)),
    ).toEqual([
      ['work', '2026-10-26T19:00:00.000Z', '2026-10-26T21:15:00.000Z'],
      ['break', '2026-10-26T21:15:00.000Z', '2026-10-26T21:45:00.000Z'],
      ['work', '2026-10-26T21:45:00.000Z', '2026-10-27T00:00:00.000Z'],
    ]);
    // The break starts at midnight exactly: the first part ends at 00:00 of the next day.
    expect(
      instants(insertBreakIntoRow(rows({ start: '22:00', end: '02:30', endsNextDay: true }), 'row-0', key)),
    ).toEqual([
      ['work', '2026-10-26T21:00:00.000Z', '2026-10-26T23:00:00.000Z'],
      ['break', '2026-10-26T23:00:00.000Z', '2026-10-26T23:30:00.000Z'],
      ['work', '2026-10-26T23:30:00.000Z', '2026-10-27T01:30:00.000Z'],
    ]);
  });
});
