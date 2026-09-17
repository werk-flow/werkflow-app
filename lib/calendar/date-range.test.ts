import { describe, expect, test } from "bun:test";

import { calendarDateFromQuery, parseIsoDateRange } from "./date-range";

describe("calendar ISO date range boundary", () => {
  test("accepts an ordered range inside the maximum span", () => {
    expect(parseIsoDateRange({ from: "2026-08-30", to: "2026-10-12" })).toEqual({
      from: "2026-08-30",
      to: "2026-10-12",
    });
    expect(parseIsoDateRange({ from: "2026-09-08", to: "2026-09-08" })).toEqual({
      from: "2026-09-08",
      to: "2026-09-08",
    });
  });

  test("rejects reversed, malformed, impossible, oversized, and non-object input", () => {
    expect(parseIsoDateRange({ from: "2026-09-09", to: "2026-09-08" })).toBeNull();
    expect(parseIsoDateRange({ from: "2026-9-8", to: "2026-09-08" })).toBeNull();
    expect(parseIsoDateRange({ from: "2026-02-30", to: "2026-03-01" })).toBeNull();
    expect(parseIsoDateRange({ from: "2025-01-01", to: "2026-12-31" })).toBeNull();
    expect(parseIsoDateRange({ from: 20260908, to: "2026-09-08" })).toBeNull();
    expect(parseIsoDateRange("2026-09-08")).toBeNull();
    expect(parseIsoDateRange(null)).toBeNull();
  });
});

test('calendar bookmarks accept only real single ISO dates and otherwise preserve today', () => {
  const today = '2026-09-08';
  expect(calendarDateFromQuery('2026-06-15', today)).toBe('2026-06-15');
  expect(calendarDateFromQuery('2028-02-29', today)).toBe('2028-02-29');
  for (const input of [undefined, ['2026-06-15'], '2026-02-29', '2026-2-01', '2026-06-15T12:00:00Z', 'invalid']) {
    expect(calendarDateFromQuery(input, today)).toBe(today);
  }
});
