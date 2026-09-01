import { describe, expect, test } from "bun:test";
import { calculateEmployeePeriod, roundSecondsToMinutes } from "./calculation";
import type { TimeAccountPolicy } from "./types";

const policy: TimeAccountPolicy = {
  id: "policy-1",
  version: 1,
  effectiveFrom: "2026-10-01",
  vacationTreatment: "paid",
  sicknessTreatment: "paid",
  warningRules: [],
  nightWindow: { start: "22:00", end: "06:00" },
  creditRules: [
    { activityKind: "work", percentage: 100 },
    { activityKind: "break", percentage: 0 },
    { activityKind: "internal_activity", percentage: 100 },
    { activityKind: "callout", percentage: 100 },
    {
      activityKind: "travel",
      travelRoute: "site_to_site",
      travelRole: "driver",
      percentage: 50,
    },
    { activityKind: "standby", standbyContext: "remote", percentage: 50 },
  ],
  supplementRules: [
    {
      supplementKind: "night",
      enabled: true,
      eligibleActivityKinds: ["work", "callout"],
    },
    {
      supplementKind: "sunday",
      enabled: true,
      eligibleActivityKinds: ["work", "callout"],
    },
    {
      supplementKind: "public_holiday",
      enabled: true,
      eligibleActivityKinds: ["work"],
    },
  ],
};

describe("P1-23 time-account calculation", () => {
  test("rounds one aggregate bucket once and exposes the delta", () => {
    expect(roundSecondsToMinutes(89)).toEqual({
      minutes: 1,
      roundingDeltaSeconds: -29,
    });
    expect(roundSecondsToMinutes(90)).toEqual({
      minutes: 2,
      roundingDeltaSeconds: 30,
    });
  });

  test("keeps short segments together before applying 50 percent and rounding", () => {
    const result = calculateEmployeePeriod({
      employeeRecordId: "employee-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      previousBalanceMinutes: 30,
      policy,
      publicHolidayDates: new Set(),
      dailyTargets: [
        {
          localDate: "2026-10-05",
          targetMinutes: 60,
          source: "schedule",
          vacationMinutes: 0,
          sicknessMinutes: 0,
        },
      ],
      accountEvents: [],
      activityIntervals: [
        {
          sourceId: "a",
          activityKind: "travel",
          travelRoute: "site_to_site",
          travelRole: "driver",
          startedAt: "2026-10-05T08:00:00.000Z",
          endedAt: "2026-10-05T08:00:40.000Z",
        },
        {
          sourceId: "b",
          activityKind: "travel",
          travelRoute: "site_to_site",
          travelRole: "driver",
          startedAt: "2026-10-05T08:01:00.000Z",
          endedAt: "2026-10-05T08:01:40.000Z",
        },
      ],
    });
    expect(result.activityBuckets).toHaveLength(1);
    expect(result.activityBuckets[0]).toMatchObject({
      sourceSeconds: 80,
      sourceMinutes: 1,
      creditedSeconds: 40,
      creditedMinutes: 1,
      roundingDeltaSeconds: 20,
      percentage: 50,
    });
    expect(result.closingBalanceMinutes).toBe(-29);
  });

  test("applies a mid-month policy version on its Berlin effective date", () => {
    const zeroCreditPolicy: TimeAccountPolicy = {
      ...policy,
      id: "policy-2",
      version: 2,
      effectiveFrom: "2026-10-15",
      creditRules: policy.creditRules.map((rule) => ({
        ...rule,
        percentage: 0,
      })),
    };
    const result = calculateEmployeePeriod({
      employeeRecordId: "employee-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      previousBalanceMinutes: 0,
      policy: zeroCreditPolicy,
      policyByDate: new Map([
        ["2026-10-14", policy],
        ["2026-10-15", zeroCreditPolicy],
      ]),
      publicHolidayDates: new Set(),
      dailyTargets: [],
      accountEvents: [],
      activityIntervals: [
        {
          sourceId: "before-version",
          activityKind: "work",
          startedAt: "2026-10-14T08:00:00.000Z",
          endedAt: "2026-10-14T09:00:00.000Z",
        },
        {
          sourceId: "after-version",
          activityKind: "work",
          startedAt: "2026-10-15T08:00:00.000Z",
          endedAt: "2026-10-15T09:00:00.000Z",
        },
      ],
    });

    expect(
      result.activityBuckets.map((bucket) => [
        bucket.localDate,
        bucket.percentage,
        bucket.creditedMinutes,
      ]),
    ).toEqual([
      ["2026-10-14", 100, 60],
      ["2026-10-15", 0, 0],
    ]);
  });

  test("splits Berlin days and allows overlapping night, Sunday and holiday classifications", () => {
    const result = calculateEmployeePeriod({
      employeeRecordId: "employee-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      previousBalanceMinutes: 0,
      policy,
      publicHolidayDates: new Set(["2026-10-04"]),
      dailyTargets: [
        {
          localDate: "2026-10-03",
          targetMinutes: 0,
          source: "schedule",
          vacationMinutes: 0,
          sicknessMinutes: 0,
        },
        {
          localDate: "2026-10-04",
          targetMinutes: 0,
          source: "schedule",
          vacationMinutes: 0,
          sicknessMinutes: 0,
        },
      ],
      accountEvents: [],
      activityIntervals: [
        {
          sourceId: "overnight",
          activityKind: "work",
          startedAt: "2026-10-03T21:30:00.000Z",
          endedAt: "2026-10-04T01:30:00.000Z",
        },
      ],
    });
    expect(
      result.activityBuckets.map((bucket) => [
        bucket.localDate,
        bucket.creditedMinutes,
      ]),
    ).toEqual([
      ["2026-10-03", 30],
      ["2026-10-04", 210],
    ]);
    expect(
      result.supplementBuckets.map((bucket) => [
        bucket.localDate,
        bucket.supplementKind,
        bucket.minutes,
      ]),
    ).toEqual([
      ["2026-10-03", "night", 30],
      ["2026-10-04", "night", 210],
      ["2026-10-04", "public_holiday", 210],
      ["2026-10-04", "sunday", 210],
    ]);
  });

  test("marks fallback targets non-authoritative and keeps absence minutes separate", () => {
    const result = calculateEmployeePeriod({
      employeeRecordId: "employee-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      previousBalanceMinutes: 10,
      policy,
      publicHolidayDates: new Set(),
      activityIntervals: [],
      dailyTargets: [
        {
          localDate: "2026-10-06",
          targetMinutes: 0,
          source: "default",
          vacationMinutes: 480,
          sicknessMinutes: 0,
        },
      ],
      accountEvents: [
        {
          id: "adjustment",
          kind: "manual_adjustment",
          effectiveDate: "2026-10-06",
          minutes: 15,
        },
      ],
    });
    expect(result.hasAuthoritativeTargets).toBeFalse();
    expect(result.vacationMinutes).toBe(480);
    expect(result.accountEventMinutes).toBe(15);
    expect(result.closingBalanceMinutes).toBe(25);
  });

  test("excludes interval slices outside the requested period", () => {
    const result = calculateEmployeePeriod({
      employeeRecordId: "employee-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      previousBalanceMinutes: 0,
      policy,
      publicHolidayDates: new Set(),
      dailyTargets: [
        {
          localDate: "2026-10-01",
          targetMinutes: 0,
          source: "schedule",
          vacationMinutes: 0,
          sicknessMinutes: 0,
        },
      ],
      accountEvents: [],
      activityIntervals: [
        {
          sourceId: "boundary",
          activityKind: "work",
          startedAt: "2026-09-30T20:00:00.000Z",
          endedAt: "2026-10-01T02:00:00.000Z",
        },
      ],
    });
    expect(result.activityBuckets.map((bucket) => bucket.localDate)).toEqual([
      "2026-10-01",
    ]);
    expect(result.creditedMinutes).toBe(240);
  });
});
