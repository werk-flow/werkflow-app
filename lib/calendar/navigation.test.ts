import { beforeAll, describe, expect, test } from "bun:test";

import {
  getCalendarFetchRange,
  getCalendarMonthFetchRange,
  rangeCovers,
  shiftCalendarDate,
} from "./navigation";

// The calendar renders in the browser's local time. The product's users sit in
// Europe/Berlin, whose DST switches are the boundary this window logic must
// survive. Bun applies TZ at runtime, so the whole file runs in Berlin time.
beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});

function local(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

describe("calendar navigation", () => {
  test("moves forward from the 31st without skipping a shorter month", () => {
    const result = shiftCalendarDate(new Date(2026, 7, 31, 12), "month", 1);

    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(1);
  });

  test("moves backward from the 31st without remaining in the same month", () => {
    const result = shiftCalendarDate(new Date(2026, 2, 31, 12), "month", -1);

    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(1);
  });

  test("keeps day and week navigation behavior", () => {
    const source = new Date(2026, 7, 31, 12);

    expect(shiftCalendarDate(source, "day", 1).getDate()).toBe(1);
    expect(shiftCalendarDate(source, "week", -1).getDate()).toBe(24);
    expect(source.getDate()).toBe(31);
  });

  test("covers every day in a six-week month grid plus session-pairing edges", () => {
    const august = getCalendarMonthFetchRange(new Date(2026, 7, 31, 12));
    const february = getCalendarMonthFetchRange(new Date(2027, 1, 10, 12));

    expect(august.start).toEqual(new Date(2026, 6, 26, 0, 0, 0, 0));
    expect(august.end).toEqual(new Date(2026, 8, 7, 23, 59, 59, 999));
    expect(february.start).toEqual(new Date(2027, 0, 31, 0, 0, 0, 0));
    expect(february.end).toEqual(new Date(2027, 2, 15, 23, 59, 59, 999));
  });
});

describe("calendar fetch range (PF-01)", () => {
  test("the day window is the previous day through the end of the selected day", () => {
    const range = getCalendarFetchRange(local(2026, 9, 1), "day");
    expect(range.start).toEqual(new Date(2026, 7, 31, 0, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 8, 1, 23, 59, 59, 999));
  });

  test("a week starting in the previous month ends nine days after its Sunday, not in the next month", () => {
    // Tuesday 1 September 2026: Monday is 31 August. The old arithmetic
    // produced 30 August through 8 October.
    const range = getCalendarFetchRange(local(2026, 9, 1), "week");
    expect(range.start).toEqual(new Date(2026, 7, 30, 0, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 8, 7, 23, 59, 59, 999));
  });

  test("a week crossing the year boundary stays nine days wide", () => {
    const range = getCalendarFetchRange(local(2026, 1, 1), "week");
    expect(range.start).toEqual(new Date(2025, 11, 28, 0, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 0, 5, 23, 59, 59, 999));
  });

  test("a week entirely inside one month keeps the original window", () => {
    const range = getCalendarFetchRange(local(2026, 9, 8), "week");
    expect(range.start).toEqual(new Date(2026, 8, 6, 0, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 8, 14, 23, 59, 59, 999));
  });

  test("a Sunday belongs to the week that started six days earlier", () => {
    const range = getCalendarFetchRange(local(2026, 10, 25), "week");
    expect(range.start).toEqual(new Date(2026, 9, 18, 0, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 9, 26, 23, 59, 59, 999));
  });

  test("leap day and the DST switches keep whole local days", () => {
    const leap = getCalendarFetchRange(local(2028, 2, 29), "day");
    expect(leap.start).toEqual(new Date(2028, 1, 28, 0, 0, 0, 0));
    expect(leap.end).toEqual(new Date(2028, 1, 29, 23, 59, 59, 999));

    // 29 March 2026 02:00 CET -> 03:00 CEST: the day is 23 hours long.
    const springForward = getCalendarFetchRange(local(2026, 3, 29), "day");
    expect(springForward.end.getTime() - springForward.start.getTime()).toBe(
      (24 + 23) * 3_600_000 - 1,
    );
    // 25 October 2026 03:00 CEST -> 02:00 CET: the day is 25 hours long.
    const fallBack = getCalendarFetchRange(local(2026, 10, 25), "day");
    expect(fallBack.end.getTime() - fallBack.start.getTime()).toBe(
      (24 + 25) * 3_600_000 - 1,
    );
    const week = getCalendarFetchRange(local(2026, 3, 29), "week");
    expect(week.start).toEqual(new Date(2026, 2, 22, 0, 0, 0, 0));
    expect(week.end).toEqual(new Date(2026, 2, 30, 23, 59, 59, 999));
  });

  test("month delegates to the six-week grid window", () => {
    expect(getCalendarFetchRange(local(2026, 8, 31), "month")).toEqual(
      getCalendarMonthFetchRange(local(2026, 8, 31)),
    );
  });

  test("a day inside a fetched week is covered; the next day outside it is not", () => {
    const week = getCalendarFetchRange(local(2026, 9, 8), "week");
    expect(rangeCovers(week, getCalendarFetchRange(local(2026, 9, 10), "day"))).toBe(true);
    expect(rangeCovers(week, getCalendarFetchRange(local(2026, 9, 7), "day"))).toBe(true);
    expect(rangeCovers(week, getCalendarFetchRange(local(2026, 9, 6), "day"))).toBe(false);
    expect(rangeCovers(week, getCalendarFetchRange(local(2026, 9, 15), "day"))).toBe(false);
    expect(rangeCovers(week, getCalendarFetchRange(local(2026, 9, 8), "month"))).toBe(false);
  });
});
