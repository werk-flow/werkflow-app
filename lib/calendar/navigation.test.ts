import { describe, expect, test } from "bun:test";

import { getCalendarMonthFetchRange, shiftCalendarDate } from "./navigation";

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
