import { z } from '@/lib/zod';

import type { Database, Json } from '@/lib/supabase/database.types';
import { computeTimeBreakdown, type TimeBreakdown } from '@/lib/time-tracking/helpers';

export type OrgBreakMode = Database['public']['Enums']['time_tracking_break_mode'];

const DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES = 360;
const DEFAULT_AUTO_BREAK_DURATION_MINUTES = 30;

export const BREAK_MODE_OPTIONS: Array<{
  value: OrgBreakMode;
  label: string;
  description: string;
}> = [
  {
    value: 'manual',
    label: 'Pause manuell stempeln',
    description: 'Mitarbeiter starten und beenden ihre Pausen weiterhin selbst per Pause-Button.',
  },
  {
    value: 'automatic',
    label: 'Pause automatisch abziehen',
    description:
      'Sobald die konfigurierte Arbeitszeit erreicht ist, wird die feste Pausenzeit automatisch abgezogen.',
  },
];

export const timeTrackingSettingsSchema = z
  .object({
    breakMode: z.enum(['manual', 'automatic']),
    autoBreakThresholdMinutes: z.coerce.number().int().min(1).max(1440),
    autoBreakDurationMinutes: z.coerce.number().int().min(0).max(1440),
  })
  .superRefine((value, ctx) => {
    if (value.autoBreakDurationMinutes > value.autoBreakThresholdMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['autoBreakDurationMinutes'],
        message: 'Die Pause darf nicht länger als die Schwelle sein.',
      });
    }
  });

export type TimeTrackingSettingsValues = z.infer<typeof timeTrackingSettingsSchema>;

const breakPolicyHistoryEntrySchema = z.object({
  breakMode: z.enum(['manual', 'automatic']),
  autoBreakThresholdMinutes: z.number().int().min(1).max(1440),
  autoBreakDurationMinutes: z.number().int().min(0).max(1440),
  // Postgres writes the first entry with a `+00:00` offset, the app with `Z`.
  // Both are accepted and read back in the `Z` form.
  effectiveFrom: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
});

export type BreakPolicyHistoryEntry = z.infer<typeof breakPolicyHistoryEntrySchema>;

/** One version of the break rule: the mode and its automatic step. */
export type BreakPolicyValues = Pick<
  BreakPolicyHistoryEntry,
  'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'
>;

/**
 * The organization's break rule: the current version and every earlier one.
 * A past day resolves against the version that applied to it
 * (`resolveBreakPolicyAtTimestamp`), so a rule change never moves it.
 */
export type BreakPolicy = BreakPolicyValues & { breakPolicyHistory: BreakPolicyHistoryEntry[] };

export type OrganizationTimeTrackingSettings = BreakPolicy & { organizationId: string };

/** Only the break rule of a value that carries more, such as the organization settings. */
export function breakPolicyOf(settings: BreakPolicy): BreakPolicy {
  return {
    breakMode: settings.breakMode,
    autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
    breakPolicyHistory: settings.breakPolicyHistory,
  };
}

/** Only the current version of a rule, without the earlier ones. */
export function currentBreakPolicy(policy: BreakPolicyValues): BreakPolicyValues {
  return {
    breakMode: policy.breakMode,
    autoBreakThresholdMinutes: policy.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: policy.autoBreakDurationMinutes,
  };
}

/** A key that changes whenever the rule or one of its versions changes. */
export function breakPolicyKey(policy: BreakPolicyValues): string {
  return JSON.stringify(policy);
}

export function getDefaultTimeTrackingSettings(organizationId: string): OrganizationTimeTrackingSettings {
  return {
    organizationId,
    breakMode: 'manual',
    autoBreakThresholdMinutes: DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES,
    autoBreakDurationMinutes: DEFAULT_AUTO_BREAK_DURATION_MINUTES,
    breakPolicyHistory: [],
  };
}

export function buildBreakPolicyHistoryEntry(
  values: BreakPolicyValues,
  effectiveFrom = new Date().toISOString(),
): BreakPolicyHistoryEntry {
  return {
    breakMode: values.breakMode,
    autoBreakThresholdMinutes: values.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: values.autoBreakDurationMinutes,
    effectiveFrom,
  };
}

export function parseBreakPolicyHistory(value: Json | null | undefined): BreakPolicyHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => breakPolicyHistoryEntrySchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort((a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
}

/**
 * The stored settings with defaults for missing values. The history is
 * required: settings without it would resolve every past day against the
 * current rule.
 */
export function normalizeTimeTrackingSettings(
  input: Partial<BreakPolicyValues> &
    Pick<OrganizationTimeTrackingSettings, 'organizationId' | 'breakPolicyHistory'>,
): OrganizationTimeTrackingSettings {
  return {
    organizationId: input.organizationId,
    breakMode: input.breakMode ?? 'manual',
    autoBreakThresholdMinutes: input.autoBreakThresholdMinutes ?? DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES,
    autoBreakDurationMinutes: input.autoBreakDurationMinutes ?? DEFAULT_AUTO_BREAK_DURATION_MINUTES,
    breakPolicyHistory: input.breakPolicyHistory,
  };
}

export function resolveBreakPolicyAtTimestamp(
  settings: BreakPolicy,
  referenceTimestamp?: string | Date | null,
): BreakPolicyValues {
  const history = settings.breakPolicyHistory;
  const [earliestEntry] = history;

  if (!earliestEntry || !referenceTimestamp) {
    return {
      breakMode: settings.breakMode,
      autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
    };
  }

  const referenceMs =
    referenceTimestamp instanceof Date
      ? referenceTimestamp.getTime()
      : new Date(referenceTimestamp).getTime();

  if (!Number.isFinite(referenceMs)) {
    return {
      breakMode: settings.breakMode,
      autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
    };
  }

  const matchingEntry =
    [...history].reverse().find((entry) => new Date(entry.effectiveFrom).getTime() <= referenceMs) ??
    earliestEntry;

  return {
    breakMode: matchingEntry.breakMode,
    autoBreakThresholdMinutes: matchingEntry.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: matchingEntry.autoBreakDurationMinutes,
  };
}

export function computeBreakdownForSettings(
  totalMinutes: number,
  trackedBreakMinutes: number,
  settings: BreakPolicyValues | null | undefined,
  targetMinutes?: number,
): TimeBreakdown {
  if (!settings || settings.breakMode === 'manual') {
    return computeTimeBreakdown(totalMinutes, trackedBreakMinutes, targetMinutes);
  }

  const breakMinutes =
    totalMinutes >= settings.autoBreakThresholdMinutes ? settings.autoBreakDurationMinutes : 0;

  return computeTimeBreakdown(totalMinutes, breakMinutes, targetMinutes);
}

export function getAutomaticBreakRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  settings: BreakPolicyValues | null | undefined,
): { breakStart: Date; breakEnd: Date } | null {
  if (
    !start ||
    !end ||
    !settings ||
    settings.breakMode !== 'automatic' ||
    settings.autoBreakDurationMinutes <= 0
  ) {
    return null;
  }

  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  const totalMinutes = (endMs - startMs) / 60000;
  if (totalMinutes < settings.autoBreakThresholdMinutes) {
    return null;
  }

  const breakEnd = new Date(startMs + settings.autoBreakThresholdMinutes * 60000);
  const breakStart = new Date(breakEnd.getTime() - settings.autoBreakDurationMinutes * 60000);

  if (breakStart <= startDate || breakEnd > endDate) {
    return null;
  }

  return { breakStart, breakEnd };
}

// The start of an organization's first recorded version when the rule it had
// before was never recorded: it covers every earlier day.
const FIRST_VERSION_EFFECTIVE_FROM = new Date(0).toISOString();

/**
 * The history after a rule change. An organization without recorded versions
 * first records the rule it had until now, so its earlier days keep it instead
 * of falling back to the new version.
 */
export function appendBreakPolicyHistory(
  current: BreakPolicy,
  nextEntry: BreakPolicyHistoryEntry,
): BreakPolicyHistoryEntry[] {
  const history =
    current.breakPolicyHistory.length > 0
      ? current.breakPolicyHistory
      : [buildBreakPolicyHistoryEntry(current, FIRST_VERSION_EFFECTIVE_FROM)];
  const lastEntry = history[history.length - 1];

  if (
    lastEntry &&
    lastEntry.breakMode === nextEntry.breakMode &&
    lastEntry.autoBreakThresholdMinutes === nextEntry.autoBreakThresholdMinutes &&
    lastEntry.autoBreakDurationMinutes === nextEntry.autoBreakDurationMinutes
  ) {
    return history;
  }

  return [...history, nextEntry];
}
