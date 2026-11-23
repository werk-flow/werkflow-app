// A machine runs only inside its Berlin window: the standing rule and its dated exceptions name the
// size, a run never crosses a size change or an off window, and a file that cannot say holds.
import { describe, expect, test } from 'bun:test';
import { admitRun, MAC_STANDING, PC_STANDING, resolveWindow, type WindowFile } from './windows';

const at = (iso: string): Date => new Date(iso);
const MINUTE = 60_000;
const RESERVE = { reserveMs: 2 * MINUTE };

const mac = (exceptions?: WindowFile['exceptions']): WindowFile => ({
  timezone: 'Europe/Berlin',
  standing: [...MAC_STANDING],
  ...(exceptions ? { exceptions } : {}),
});
const pc = (exceptions?: WindowFile['exceptions']): WindowFile => ({
  timezone: 'Europe/Berlin',
  standing: [...PC_STANDING],
  ...(exceptions ? { exceptions } : {}),
});
/** The Mac's `row()` fixture: Monday 2026-11-23 at 8/8 until 16:00. */
const macRow = { date: '2026-11-23', from: '00:00', to: '16:00', size: '8/8', reason: 'fixture' };

const sizeAt = (file: unknown, iso: string): string => {
  const answer = resolveWindow(file, at(iso));
  return answer.kind === 'open' ? answer.size : answer.kind;
};
const window = (file: unknown, iso: string) => {
  const answer = resolveWindow(file, at(iso));
  return answer.kind === 'hold' ? answer : { ...answer, until: answer.until?.toISOString() ?? null };
};
const admit = (file: unknown, iso: string, expectedMs: number) => {
  const answer = admitRun(file, at(iso), { expectedMs, ...RESERVE });
  return answer.admit ? answer : { ...answer, retryAt: answer.retryAt?.toISOString() ?? null };
};

describe('a standing rule that crosses midnight keeps its Berlin wall times across a clock change', () => {
  test('the Mac night before the spring change lasts 8 hours and ends at 05:00 summer time', () => {
    expect(window(mac(), '2026-03-28T21:00:00+01:00')).toEqual({
      kind: 'open',
      size: '8/8',
      until: '2026-03-29T03:00:00.000Z',
    });
    expect(sizeAt(mac(), '2026-03-29T04:59:00+02:00')).toBe('8/8');
    expect(window(mac(), '2026-03-29T05:00:00+02:00')).toEqual({
      kind: 'open',
      size: '4/6',
      until: '2026-03-29T18:00:00.000Z',
    });
  });

  test('the Mac night before the autumn change lasts 10 hours and ends at 05:00 winter time', () => {
    expect(window(mac(), '2026-10-24T21:00:00+02:00')).toEqual({
      kind: 'open',
      size: '8/8',
      until: '2026-10-25T04:00:00.000Z',
    });
    expect(sizeAt(mac(), '2026-10-25T02:30:00+01:00')).toBe('8/8');
  });

  const insideTheChange: WindowFile = {
    timezone: 'Europe/Berlin',
    standing: [
      { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '02:30', to: '14:00', size: 'day' },
      { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '14:00', to: '02:30', size: 'night' },
    ],
  };

  test('a boundary in the spring gap moves to the end of the gap', () => {
    expect(window(insideTheChange, '2026-03-29T01:00:00+01:00')).toEqual({
      kind: 'open',
      size: 'night',
      until: '2026-03-29T01:00:00.000Z',
    });
    expect(sizeAt(insideTheChange, '2026-03-29T03:00:00+02:00')).toBe('day');
  });

  test('a boundary in the repeated autumn hour is its first occurrence, and the repeat belongs to the next rule', () => {
    expect(window(insideTheChange, '2026-10-25T01:00:00+02:00')).toEqual({
      kind: 'open',
      size: 'night',
      until: '2026-10-25T00:30:00.000Z',
    });
    expect(sizeAt(insideTheChange, '2026-10-25T02:10:00+01:00')).toBe('day');
  });
});

describe('an exception overrides the standing rule only within its interval', () => {
  const live = mac([
    macRow,
    { date: '2026-11-23', from: '16:00', to: '20:00', size: '4/6', reason: 'Owner needs the Mac.' },
  ]);

  test("the Mac's live file: the night runs on until 16:00, the day size until 20:00, then the standing night", () => {
    expect(window(live, '2026-11-23T04:59:00+01:00')).toEqual({
      kind: 'open',
      size: '8/8',
      until: '2026-11-23T15:00:00.000Z',
    });
    expect(window(live, '2026-11-23T16:00:00+01:00')).toEqual({
      kind: 'open',
      size: '4/6',
      until: '2026-11-23T19:00:00.000Z',
    });
    expect(window(live, '2026-11-23T20:00:00+01:00')).toEqual({
      kind: 'open',
      size: '8/8',
      until: '2026-11-24T04:00:00.000Z',
    });
  });

  test('an exception of the standing size across a whole interval merges with its neighbours', () => {
    const allNight = mac([{ date: '2026-11-23', from: '05:00', to: '20:00', size: '8/8', reason: 'r' }]);
    expect(window(allNight, '2026-11-23T04:00:00+01:00')).toEqual({
      kind: 'open',
      size: '8/8',
      until: '2026-11-24T04:00:00.000Z',
    });
  });

  test('an exception that starts at a standing boundary and ends inside the next interval', () => {
    const pcLate = pc([{ date: '2026-11-23', from: '17:00', to: '22:00', size: 'off', reason: 'r' }]);
    expect(window(pcLate, '2026-11-23T06:00:00+01:00')).toEqual({
      kind: 'off',
      until: '2026-11-23T21:00:00.000Z',
    });
    expect(window(pcLate, '2026-11-23T22:00:00+01:00')).toEqual({
      kind: 'open',
      size: 'full',
      until: '2026-11-27T05:00:00.000Z',
    });
  });

  test('a standing rule that never changes answers until null', () => {
    const always: WindowFile = {
      timezone: 'Europe/Berlin',
      standing: [
        { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '00:00', size: 'full' },
      ],
    };
    expect(window(always, '2026-11-23T10:00:00+01:00')).toEqual({ kind: 'open', size: 'full', until: null });
    expect(admit(always, '2026-11-23T10:00:00+01:00', 500 * 60 * MINUTE)).toEqual({
      admit: true,
      size: 'full',
    });
  });
});

describe('admitRun refuses a run that would not end strictly before the window turns off or changes size', () => {
  const run = 202 * MINUTE;

  test('a 202-minute PC run on Monday at 02:40 waits for 17:00; at 02:35 it starts', () => {
    expect(admit(pc(), '2026-11-23T02:40:00+01:00', run)).toMatchObject({
      admit: false,
      retryAt: '2026-11-23T16:00:00.000Z',
    });
    expect(admit(pc(), '2026-11-23T02:35:00+01:00', run)).toEqual({ admit: true, size: 'full' });
  });

  test('a PC run that would end exactly at 06:00 with its reserve is refused', () => {
    expect(admit(pc(), '2026-11-27T02:36:00+01:00', run)).toMatchObject({
      admit: false,
      retryAt: '2026-11-27T16:00:00.000Z',
    });
  });

  test('inside the PC off window a run waits for 17:00 and starts at 17:00', () => {
    expect(admit(pc(), '2026-11-23T10:00:00+01:00', run)).toMatchObject({
      admit: false,
      retryAt: '2026-11-23T16:00:00.000Z',
    });
    expect(admit(pc(), '2026-11-23T17:00:00+01:00', run)).toEqual({ admit: true, size: 'full' });
  });

  test('a PC run crosses midnight into Monday freely, since the size does not change', () => {
    expect(admit(pc(), '2026-11-22T23:00:00+01:00', run)).toEqual({ admit: true, size: 'full' });
  });

  test('a run longer than every PC window gets no retry time', () => {
    expect(admit(pc(), '2026-11-23T10:00:00+01:00', 100 * 60 * MINUTE)).toMatchObject({
      admit: false,
      retryAt: null,
    });
  });

  test('a Mac day run that would cross the 20:00 resize waits for the night', () => {
    expect(admit(mac(), '2026-11-23T19:00:00+01:00', 60 * MINUTE)).toMatchObject({
      admit: false,
      retryAt: '2026-11-23T19:00:00.000Z',
    });
    expect(admit(mac(), '2026-11-23T18:57:00+01:00', 60 * MINUTE)).toEqual({ admit: true, size: '4/6' });
  });
});

describe('a file that cannot say holds and never guesses a size', () => {
  const holds = (file: unknown): void => {
    expect(resolveWindow(file, at('2026-11-23T10:00:00+01:00')).kind).toBe('hold');
    expect(admit(file, '2026-11-23T10:00:00+01:00', MINUTE)).toMatchObject({ admit: false, retryAt: null });
  };

  test('another time zone holds', () => holds({ ...mac(), timezone: 'UTC' }));
  test('a standing gap holds', () => holds({ ...mac(), standing: [MAC_STANDING[0]] }));
  test('overlapping standing rules hold', () =>
    holds({ ...mac(), standing: [...MAC_STANDING, MAC_STANDING[0]] }));
  test('a time past 23:59 holds', () => holds(mac([{ ...macRow, to: '24:00' }])));
  test('an exception that ends before it starts holds', () =>
    holds(mac([{ ...macRow, from: '16:00', to: '10:00' }])));
  test('an exception on no real date holds', () => holds(mac([{ ...macRow, date: '2026-02-30' }])));
  test('an exception without a reason holds', () => holds(mac([{ ...macRow, reason: '' }])));
  test('an unknown key holds', () => holds({ ...mac(), exception: [macRow] }));
  test('the hold names what is wrong', () => {
    expect(resolveWindow({ ...mac(), standing: [MAC_STANDING[0]] }, at('2026-11-23T10:00:00+01:00'))).toEqual(
      {
        kind: 'hold',
        reason: 'The window file is invalid: standing leaves mon 05:00 uncovered.',
      },
    );
  });
});

// The Mac's offline tests (bin/test_window_policy.py), one test per case, with the standing rule
// written out and a 120 s reserve.
describe("the Mac's window policy cases", () => {
  test('expired exception ignored', () =>
    expect(sizeAt(mac([macRow]), '2026-11-24T10:00:00+01:00')).toBe('4/6'));
  test('future exception inactive until date', () =>
    expect(sizeAt(mac([macRow]), '2026-11-22T10:00:00+01:00')).toBe('4/6'));
  test('monday exception active', () =>
    expect(sizeAt(mac([macRow]), '2026-11-23T10:00:00+01:00')).toBe('8/8'));
  test('full run crossing 16:00 refused', () =>
    expect(admit(mac([macRow]), '2026-11-23T15:00:00+01:00', 60 * MINUTE)).toMatchObject({
      admit: false,
      retryAt: '2026-11-23T15:00:00.000Z',
    }));
  test('small run that fits admitted', () =>
    expect(admit(mac([macRow]), '2026-11-23T15:40:00+01:00', 5 * MINUTE)).toEqual({
      admit: true,
      size: '8/8',
    }));
  test('resize reserve refused', () =>
    expect(admit(mac([macRow]), '2026-11-23T15:55:00+01:00', 3 * MINUTE)).toMatchObject({ admit: false }));
  test('resize prepares between runs: inside the reserve no run starts, and the next one starts at 4/6', () => {
    expect(admit(mac([macRow]), '2026-11-23T15:58:00+01:00', 0)).toMatchObject({
      admit: false,
      retryAt: '2026-11-23T15:00:00.000Z',
    });
    expect(admit(mac([macRow]), '2026-11-23T16:00:00+01:00', 0)).toEqual({ admit: true, size: '4/6' });
  });
  test('missing exceptions use the standing rule', () =>
    expect(sizeAt(mac(), '2026-11-23T10:00:00+01:00')).toBe('4/6'));
  test('malformed file holds instead of default', () =>
    expect(resolveWindow('{invalid', at('2026-11-23T10:00:00+01:00')).kind).toBe('hold'));
  test('overlap refused', () =>
    expect(window(mac([macRow, macRow]), '2026-11-23T10:00:00+01:00')).toEqual({
      kind: 'hold',
      reason: 'The window file is invalid: exceptions.1 overlaps exception 0 on 2026-11-23.',
    }));
  test('standing night ends at 05:00', () => {
    expect(sizeAt(mac([macRow]), '2026-11-23T20:00:00+01:00')).toBe('8/8');
    expect(sizeAt(mac([macRow]), '2026-11-24T04:59:00+01:00')).toBe('8/8');
    expect(sizeAt(mac([macRow]), '2026-11-24T05:00:00+01:00')).toBe('4/6');
  });
  test('tuesday 2026-11-24 05:00 is day 4/6', () =>
    expect(sizeAt(mac([macRow]), '2026-11-24T05:00:00+01:00')).toBe('4/6'));
  test('full run crossing tuesday 05:00 refused', () =>
    expect(admit(mac([macRow]), '2026-11-24T04:00:00+01:00', 60 * MINUTE)).toMatchObject({
      admit: false,
      retryAt: '2026-11-24T04:00:00.000Z',
    }));
  test('runtime mode uses standing 05:00', () => {
    expect(window(mac([macRow]), '2026-11-24T04:00:00+01:00')).toEqual({
      kind: 'open',
      size: '8/8',
      until: '2026-11-24T04:00:00.000Z',
    });
    expect(sizeAt(mac([macRow]), '2026-11-24T05:00:00+01:00')).toBe('4/6');
  });
  test('16:00 is exclusive expiry', () =>
    expect(sizeAt(mac([macRow]), '2026-11-23T16:00:00+01:00')).toBe('4/6'));
});

test('CR 162: an exception more than a year ahead holds the window file instead of resolving a timeline to it', () => {
  const answer = resolveWindow(
    pc([{ ...macRow, date: '2062-11-23', size: 'off' }]),
    at('2026-11-23T02:00:00Z'),
  );
  expect(answer).toEqual({
    kind: 'hold',
    reason: "The window file's exception on 2062-11-23 lies more than a year ahead.",
  });
});

test('CR 166: an off interval the spring clock change swallows leaves the window bounded, so the next week still turns off', () => {
  const file: WindowFile = {
    timezone: 'Europe/Berlin',
    standing: [
      { days: ['sun'], from: '00:00', to: '02:10', size: 'full' },
      { days: ['sun'], from: '02:10', to: '02:20', size: 'off' },
      { days: ['sun'], from: '02:20', to: '00:00', size: 'full' },
      { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], from: '00:00', to: '00:00', size: 'full' },
    ],
  };
  const answer = resolveWindow(file, at('2026-03-23T10:00:00Z'));
  expect(answer.kind).toBe('open');
  expect(answer.kind === 'open' && answer.until).not.toBeNull();
});
