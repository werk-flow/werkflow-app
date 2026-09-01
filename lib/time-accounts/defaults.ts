import type {
  TimeSegmentKind,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from "@/lib/time-tracking/types";
import type { TimeCreditPercentage } from "./types";

const ACTIVITY_KINDS: readonly TimeSegmentKind[] = [
  "work",
  "travel",
  "break",
  "standby",
  "callout",
  "internal_activity",
];
const TRAVEL_ROUTES: readonly TimeTravelRoute[] = [
  "company_to_site",
  "home_to_site",
  "site_to_site",
  "site_to_company",
  "other",
  "unspecified",
];
const TRAVEL_ROLES: readonly TimeTravelRole[] = [
  "driver",
  "passenger",
  "unspecified",
];
const STANDBY_CONTEXTS: readonly TimeStandbyContext[] = [
  "on_site",
  "remote",
  "unspecified",
];

function travelPercentage(
  route: TimeTravelRoute,
  role: TimeTravelRole,
): TimeCreditPercentage {
  if (route === "unspecified" || role === "unspecified") return 0;
  if (route === "home_to_site") return role === "driver" ? 50 : 0;
  if (route === "other") return 50;
  return 100;
}

export const DEFAULT_CREDIT_RULES = [
  {
    activity_kind: "work",
    travel_route: null,
    travel_role: null,
    standby_context: null,
    credit_percentage: 100,
  },
  {
    activity_kind: "break",
    travel_route: null,
    travel_role: null,
    standby_context: null,
    credit_percentage: 0,
  },
  {
    activity_kind: "callout",
    travel_route: null,
    travel_role: null,
    standby_context: null,
    credit_percentage: 100,
  },
  {
    activity_kind: "internal_activity",
    travel_route: null,
    travel_role: null,
    standby_context: null,
    credit_percentage: 100,
  },
  ...TRAVEL_ROUTES.flatMap((travelRoute) =>
    TRAVEL_ROLES.map((travelRole) => ({
      activity_kind: "travel" as const,
      travel_route: travelRoute,
      travel_role: travelRole,
      standby_context: null,
      credit_percentage: travelPercentage(travelRoute, travelRole),
    })),
  ),
  ...STANDBY_CONTEXTS.map((standbyContext) => ({
    activity_kind: "standby" as const,
    travel_route: null,
    travel_role: null,
    standby_context: standbyContext,
    credit_percentage: standbyContext === "on_site" ? 100 : 0,
  })),
] as const;

export const DEFAULT_SUPPLEMENT_RULES = (
  ["night", "sunday", "public_holiday"] as const
).flatMap((supplementKind) =>
  ACTIVITY_KINDS.map((activityKind) => ({
    supplement_kind: supplementKind,
    activity_kind: activityKind,
    // Night work stays unavailable until the organization deliberately sets a window.
    enabled: supplementKind !== "night" && activityKind !== "break",
  })),
);

export const DEFAULT_WARNING_RULES = [
  {
    warning_kind: "break_duration",
    enabled: true,
    severity: "informational",
    threshold_minutes: 30,
  },
  {
    warning_kind: "daily_duration",
    enabled: true,
    severity: "informational",
    threshold_minutes: 600,
  },
  {
    warning_kind: "rest_duration",
    enabled: true,
    severity: "informational",
    threshold_minutes: 660,
  },
  {
    warning_kind: "night_work",
    enabled: true,
    severity: "informational",
    threshold_minutes: null,
  },
  {
    warning_kind: "sunday_work",
    enabled: true,
    severity: "informational",
    threshold_minutes: null,
  },
  {
    warning_kind: "public_holiday_work",
    enabled: true,
    severity: "informational",
    threshold_minutes: null,
  },
] as const;
