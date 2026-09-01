import { describe, expect, test } from "bun:test";

import {
  isIsoCalendarDate,
  isValidOptionalIsoDateRange,
} from "./validation";

describe("P1-23 action date validation", () => {
  test("accepts real ISO calendar dates only", () => {
    expect(isIsoCalendarDate("2026-02-28")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(isIsoCalendarDate("2026-2-28")).toBe(false);
  });

  test("accepts an open-ended or inclusive assignment range", () => {
    expect(isValidOptionalIsoDateRange("2026-09-01", "")).toBe(true);
    expect(
      isValidOptionalIsoDateRange("2026-09-01", "2026-09-01"),
    ).toBe(true);
  });

  test("rejects an invalid or reversed assignment end date", () => {
    expect(
      isValidOptionalIsoDateRange("2026-09-01", "2026-08-31"),
    ).toBe(false);
    expect(
      isValidOptionalIsoDateRange("2026-09-01", "2026-09-31"),
    ).toBe(false);
  });
});
