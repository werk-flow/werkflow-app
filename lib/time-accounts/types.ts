import type {
  TimeSegmentKind,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from "@/lib/time-tracking/types";

export const TIME_CREDIT_PERCENTAGES = [0, 50, 100] as const;
export type TimeCreditPercentage = (typeof TIME_CREDIT_PERCENTAGES)[number];
export type TimeAbsenceTreatment = "paid" | "unpaid" | "informational";
export type TimeSupplementKind = "night" | "sunday" | "public_holiday";
export type TimeFindingSeverity =
  | "informational"
  | "approval_required"
  | "close_blocked";
export type TimeWarningKind =
  | "break_duration"
  | "daily_duration"
  | "rest_duration"
  | "night_work"
  | "sunday_work"
  | "public_holiday_work";

export type TimeCreditRule =
  | {
      activityKind: Exclude<TimeSegmentKind, "travel" | "standby">;
      percentage: TimeCreditPercentage;
    }
  | {
      activityKind: "travel";
      travelRoute: TimeTravelRoute;
      travelRole: TimeTravelRole;
      percentage: TimeCreditPercentage;
    }
  | {
      activityKind: "standby";
      standbyContext: TimeStandbyContext;
      percentage: TimeCreditPercentage;
    };

export type TimeSupplementRule = {
  supplementKind: TimeSupplementKind;
  eligibleActivityKinds: readonly TimeSegmentKind[];
  enabled: boolean;
};

export type TimeAccountPolicy = {
  id: string;
  version: number;
  effectiveFrom: string;
  creditRules: readonly TimeCreditRule[];
  supplementRules: readonly TimeSupplementRule[];
  nightWindow: { start: string; end: string } | null;
  vacationTreatment: TimeAbsenceTreatment;
  sicknessTreatment: TimeAbsenceTreatment;
  warningRules: readonly {
    warningKind: TimeWarningKind;
    enabled: boolean;
    severity: TimeFindingSeverity;
    thresholdMinutes: number | null;
  }[];
};

export type TimeActivityContext = {
  activityKind: TimeSegmentKind;
  travelRoute?: TimeTravelRoute;
  travelRole?: TimeTravelRole;
  standbyContext?: TimeStandbyContext;
};

export type TimeActivityInterval = TimeActivityContext & {
  sourceId: string;
  startedAt: string;
  endedAt: string;
  allocationKind?: string;
  jobId?: string;
  jobNumber?: string;
  projectId?: string;
  projectNumber?: string;
};

export type DailyTargetInput = {
  localDate: string;
  targetMinutes: number;
  source: "schedule" | "employment_condition" | "default";
  vacationMinutes: number;
  sicknessMinutes: number;
};

export type RoundedTimeBucket = TimeActivityContext & {
  localDate: string;
  sourceSeconds: number;
  sourceMinutes: number;
  creditedSeconds: number;
  creditedMinutes: number;
  roundingDeltaSeconds: number;
  percentage: TimeCreditPercentage;
  sourceIds: readonly string[];
};

export type SupplementBucket = {
  localDate: string;
  supplementKind: TimeSupplementKind;
  sourceSeconds: number;
  minutes: number;
  roundingDeltaSeconds: number;
  sourceIds: readonly string[];
};

export type AccountEventInput = {
  id: string;
  kind: "opening_balance" | "manual_adjustment" | "expiry" | "payout";
  effectiveDate: string;
  minutes: number;
};

export type EmployeePeriodCalculationInput = {
  employeeRecordId: string;
  periodStart: string;
  periodEnd: string;
  previousBalanceMinutes: number;
  policy: TimeAccountPolicy;
  policyByDate?: ReadonlyMap<string, TimeAccountPolicy>;
  activityIntervals: readonly TimeActivityInterval[];
  dailyTargets: readonly DailyTargetInput[];
  accountEvents: readonly AccountEventInput[];
  publicHolidayDates: ReadonlySet<string>;
};

export type EmployeePeriodCalculation = {
  employeeRecordId: string;
  periodStart: string;
  periodEnd: string;
  policyId: string;
  policyVersion: number;
  activityBuckets: readonly RoundedTimeBucket[];
  supplementBuckets: readonly SupplementBucket[];
  targetMinutes: number;
  sourceMinutes: number;
  creditedMinutes: number;
  vacationMinutes: number;
  sicknessMinutes: number;
  accountEventMinutes: number;
  periodDeltaMinutes: number;
  overtimeCandidateMinutes: number;
  previousBalanceMinutes: number;
  closingBalanceMinutes: number;
  hasAuthoritativeTargets: boolean;
};

export type PayrollValueKind =
  | "target"
  | "source_attendance"
  | "effective_attendance"
  | "credited_activity"
  | "vacation"
  | "sickness"
  | "overtime"
  | "night_supplement"
  | "sunday_supplement"
  | "public_holiday_supplement"
  | "manual_adjustment"
  | "expiry"
  | "payout"
  | "opening_balance"
  | "closing_balance";

export type PayrollExportValueRow = {
  rowId: string;
  employeeRecordId: string;
  externalEmployeeReference: string;
  localDate: string;
  valueKind: PayrollValueKind;
  outputCode: string;
  sourceSeconds: number;
  minutes: number;
  roundingDeltaSeconds: number;
  policyVersionId: string;
  calculationVersion: number;
};

export type PayrollExportAllocationRow = {
  rowId: string;
  employeeRecordId: string;
  externalEmployeeReference: string;
  localDate: string;
  activityKind: TimeSegmentKind;
  sourceReference: string;
  sourceSeconds: number;
  creditedMinutes: number;
  allocationKind: string;
  jobNumber: string;
  projectNumber: string;
};

export type PayrollExportCorrectionRow = {
  rowId: string;
  employeeRecordId: string;
  requestId: string;
  revision: number;
  applicationId: string;
  sourceFingerprint: string;
};

export type PayrollExportManifest = {
  schemaVersion: 1;
  exportId: string;
  exportVersion: number;
  supersedesExportId: string | null;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  closeVersion: number;
  mappingVersion: number;
  generatorVersion: string;
  generatedAt: string;
  scope: "organization_period";
};

export type PayrollExportInput = {
  manifest: PayrollExportManifest;
  valueRows: readonly PayrollExportValueRow[];
  allocationRows: readonly PayrollExportAllocationRow[];
  correctionRows: readonly PayrollExportCorrectionRow[];
};

export type PayrollExportPackage = {
  bytes: Uint8Array;
  sha256: string;
  files: Readonly<Record<string, Uint8Array>>;
};
