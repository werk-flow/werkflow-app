import { describe, expect, test } from "bun:test";

import { createTrailingScheduler } from "./scheduler";

/** Deterministic timers: advance the clock and fire due callbacks in order. */
function fakeClock() {
  let time = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => time,
    setTimer: (callback: () => void, delayMs: number): unknown => {
      const handle = nextHandle++;
      timers.set(handle, { at: time + delayMs, callback });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = target;
    },
  };
}

describe("trailing scheduler with bounded deferral (PF-12)", () => {
  test("a burst inside the delay lands as one run after the last event", () => {
    const clock = fakeClock();
    let runs = 0;
    const scheduler = createTrailingScheduler({ delayMs: 150, maxWaitMs: 1_000, run: () => runs++, ...clock });
    scheduler.schedule();
    clock.advance(100);
    scheduler.schedule();
    clock.advance(100);
    scheduler.schedule();
    expect(runs).toBe(0);
    clock.advance(150);
    expect(runs).toBe(1);
    expect(scheduler.pending()).toBe(false);
  });

  test("a sustained stream cannot defer the run past the maximum wait", () => {
    const clock = fakeClock();
    const runAt: number[] = [];
    const scheduler = createTrailingScheduler({ delayMs: 150, maxWaitMs: 1_000, run: () => runAt.push(clock.now()), ...clock });
    // One event every 100 ms for three seconds: the trailing delay alone would never fire.
    for (let step = 0; step < 30; step += 1) {
      scheduler.schedule();
      clock.advance(100);
    }
    expect(runAt).toEqual([1_000, 2_000, 3_000]);
    clock.advance(150);
    expect(runAt).toEqual([1_000, 2_000, 3_000]);
    // A last event after the stream lands through the ordinary trailing delay.
    scheduler.schedule();
    clock.advance(150);
    expect(runAt).toEqual([1_000, 2_000, 3_000, 3_300]);
  });

  test("cancel drops the pending run and reports it, so suspension can queue it", () => {
    const clock = fakeClock();
    let runs = 0;
    const scheduler = createTrailingScheduler({ delayMs: 150, maxWaitMs: 1_000, run: () => runs++, ...clock });
    expect(scheduler.cancel()).toBe(false);
    scheduler.schedule();
    expect(scheduler.pending()).toBe(true);
    expect(scheduler.cancel()).toBe(true);
    clock.advance(2_000);
    expect(runs).toBe(0);
    // A new burst after cancel starts its own maximum-wait window.
    scheduler.schedule();
    clock.advance(150);
    expect(runs).toBe(1);
  });

  test("rejects a maximum wait shorter than the delay", () => {
    expect(() => createTrailingScheduler({ delayMs: 150, maxWaitMs: 100, run: () => undefined })).toThrow();
  });
});
