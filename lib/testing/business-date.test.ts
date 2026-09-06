import { expect, test } from "bun:test";
import { assertRetainedBusinessDate, resolveBusinessDate } from "./business-date";

test("a retained anchor survives Berlin midnight and month boundaries", () => {
  expect(
    resolveBusinessDate("2026-08-31", new Date("2026-09-01T03:00:00Z")),
  ).toBe("2026-08-31");
  expect(resolveBusinessDate(undefined, new Date("2026-08-31T22:01:00Z"))).toBe(
    "2026-09-01",
  );
});
test("rejects malformed and impossible anchors instead of rolling them forward", () => {
  expect(() => resolveBusinessDate("2026-02-30")).toThrow();
  expect(() => resolveBusinessDate("09/05/2026")).toThrow();
  expect(() => resolveBusinessDate("")).toThrow();
});

test('restore requires the same recorded and active date before replacing working state', () => {
  expect(() => assertRetainedBusinessDate('2026-08-31', '2026-08-31')).not.toThrow();
  expect(() => assertRetainedBusinessDate(undefined, '2026-08-31')).toThrow('legacy run has none');
  expect(() => assertRetainedBusinessDate('2026-08-31', undefined)).toThrow('does not match');
  expect(() => assertRetainedBusinessDate('2026-08-31', '2026-09-01')).toThrow('does not match');
  expect(() => assertRetainedBusinessDate('2026-02-30', '2026-02-30')).toThrow('Invalid');
});
