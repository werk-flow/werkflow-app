import { z } from '@/lib/zod';

import type { Database, Json } from '@/lib/supabase/database.types';
import { computeTimeBreakdown, type TimeBreakdown } from '@/lib/time-tracking/helpers';

export type OrgBreakMode = Database['public']['Enums']['time_tracking_break_mode'];

const DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES = 360;
const DEFAULT_AUTO_BREAK_DURATION_MINUTES = 30;

/** One step of the automatic break: from this much presence, this much break in total. */
export type BreakStep = { thresholdMinutes: number; durationMinutes: number };

/**
 * The second step a new organization starts with and an existing one is
 * offered: beyond nine hours, 45 minutes in total (ArbZG § 4).
 */
const DEFAULT_SECOND_BREAK_STEP: BreakStep = { thresholdMinutes: 540, durationMinutes: 45 };

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
    secondStepEnabled: z.boolean(),
    // Checked only while the step is on: a switched-off step keeps whatever its fields hold.
    secondStepThresholdMinutes: z.coerce.number().int().min(0),
    secondStepDurationMinutes: z.coerce.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    if (value.autoBreakDurationMinutes > value.autoBreakThresholdMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['autoBreakDurationMinutes'],
        message: 'Die Pause darf nicht länger als die Schwelle sein.',
      });
    }
    if (!value.secondStepEnabled) return;
    if (value.secondStepThresholdMinutes > 1440) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepThresholdMinutes'],
        message: 'Die zweite Schwelle darf höchstens 1440 Minuten betragen.',
      });
    } else if (value.secondStepThresholdMinutes <= value.autoBreakThresholdMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepThresholdMinutes'],
        message: 'Die zweite Schwelle muss nach der ersten liegen.',
      });
    } else if (value.secondStepDurationMinutes < value.autoBreakDurationMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepDurationMinutes'],
        message: 'Die Pause der zweiten Stufe ist die Gesamtpause und darf nicht kürzer als die erste sein.',
      });
    } else if (
      value.secondStepDurationMinutes - value.autoBreakDurationMinutes >
      value.secondStepThresholdMinutes - value.autoBreakThresholdMinutes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepDurationMinutes'],
        message: 'Die zusätzliche Pause passt nicht zwischen die beiden Schwellen.',
      });
    }
  });

export type TimeTrackingSettingsValues = z.infer<typeof timeTrackingSettingsSchema>;

const breakStepSchema = z.object({
  thresholdMinutes: z.number().int().min(1).max(1440),
  durationMinutes: z.number().int().min(0).max(1440),
});

const breakPolicyHistoryEntrySchema = z.object({
  breakMode: z.enum(['manual', 'automatic']),
  autoBreakThresholdMinutes: z.number().int().min(1).max(1440),
  autoBreakDurationMinutes: z.number().int().min(0).max(1440),
  // A version saved before the second step existed has none.
  secondStep: breakStepSchema.nullish().transform((step) => step ?? null),
  // Postgres writes the first entry with a `+00:00` offset, the app with `Z`.
  // Both are accepted and read back in the `Z` form.
  effectiveFrom: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
});

export type BreakPolicyHistoryEntry = z.infer<typeof breakPolicyHistoryEntrySchema>;

/** One version of the break rule: the mode, its first automatic step and the optional second one. */
export type BreakPolicyValues = Pick<
  BreakPolicyHistoryEntry,
  'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes' | 'secondStep'
>;

/**
 * The organization's break rule: the current version and every earlier one.
 * A past day resolves against the version that applied to it
 * (`resolveBreakPolicyAtTimestamp`), so a rule change never moves it.
 */
export type BreakPolicy = BreakPolicyValues & { breakPolicyHistory: BreakPolicyHistoryEntry[] };

/** Today's break rule as the clock state carries it to the client, without the earlier versions. */
export const breakPolicyValuesSchema = z.object({
  breakMode: z.enum(['manual', 'automatic']),
  autoBreakThresholdMinutes: z.number(),
  autoBreakDurationMinutes: z.number(),
  secondStep: breakStepSchema.nullable(),
}) satisfies z.ZodType<BreakPolicyValues>;

export type OrganizationTimeTrackingSettings = BreakPolicy & { organizationId: string };

/** Only the break rule of a value that carries more, such as the organization settings. */
export function breakPolicyOf(settings: BreakPolicy): BreakPolicy {
  return {
    breakMode: settings.breakMode,
    autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
    secondStep: settings.secondStep,
    breakPolicyHistory: settings.breakPolicyHistory,
  };
}

/** Only the current version of a rule, without the earlier ones. */
export function currentBreakPolicy(policy: BreakPolicyValues): BreakPolicyValues {
  return {
    breakMode: policy.breakMode,
    autoBreakThresholdMinutes: policy.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: policy.autoBreakDurationMinutes,
    secondStep: policy.secondStep,
  };
}

/** The stored second step: both columns set, or none (the step is off). */
export function breakStepOf(
  thresholdMinutes: number | null,
  durationMinutes: number | null,
): BreakStep | null {
  return thresholdMinutes === null || durationMinutes === null ? null : { thresholdMinutes, durationMinutes };
}

/** The rule's values as the settings form edits them; a switched-off second step offers the defaults. */
export function breakPolicyFormValues(policy: BreakPolicyValues): TimeTrackingSettingsValues {
  const secondStep = policy.secondStep ?? DEFAULT_SECOND_BREAK_STEP;
  return {
    breakMode: policy.breakMode,
    autoBreakThresholdMinutes: policy.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: policy.autoBreakDurationMinutes,
    secondStepEnabled: policy.secondStep !== null,
    secondStepThresholdMinutes: secondStep.thresholdMinutes,
    secondStepDurationMinutes: secondStep.durationMinutes,
  };
}

/** The rule a saved form describes. */
export function breakPolicyValuesOf(values: TimeTrackingSettingsValues): BreakPolicyValues {
  return {
    breakMode: values.breakMode,
    autoBreakThresholdMinutes: values.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: values.autoBreakDurationMinutes,
    secondStep: values.secondStepEnabled
      ? {
          thresholdMinutes: values.secondStepThresholdMinutes,
          durationMinutes: values.secondStepDurationMinutes,
        }
      : null,
  };
}

/** Whether two versions describe the same rule. */
export function sameBreakPolicy(a: BreakPolicyValues, b: BreakPolicyValues): boolean {
  return (
    a.breakMode === b.breakMode &&
    a.autoBreakThresholdMinutes === b.autoBreakThresholdMinutes &&
    a.autoBreakDurationMinutes === b.autoBreakDurationMinutes &&
    a.secondStep?.thresholdMinutes === b.secondStep?.thresholdMinutes &&
    a.secondStep?.durationMinutes === b.secondStep?.durationMinutes
  );
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
    // Only an organization created before the settings existed has no row: it keeps one step.
    secondStep: null,
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
    secondStep: values.secondStep,
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
    secondStep: input.secondStep ?? null,
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
    return currentBreakPolicy(settings);
  }

  const referenceMs =
    referenceTimestamp instanceof Date
      ? referenceTimestamp.getTime()
      : new Date(referenceTimestamp).getTime();

  if (!Number.isFinite(referenceMs)) {
    return currentBreakPolicy(settings);
  }

  const matchingEntry =
    [...history].reverse().find((entry) => new Date(entry.effectiveFrom).getTime() <= referenceMs) ??
    earliestEntry;

  return currentBreakPolicy(matchingEntry);
}

/** The rule's automatic steps in threshold order: the first, and the second when it is on. */
function breakSteps(settings: BreakPolicyValues): BreakStep[] {
  const first = {
    thresholdMinutes: settings.autoBreakThresholdMinutes,
    durationMinutes: settings.autoBreakDurationMinutes,
  };
  return settings.secondStep ? [first, settings.secondStep] : [first];
}

/** The automatic break of a day with this much presence: the total of the last step it reached. */
function automaticBreakMinutes(totalMinutes: number, settings: BreakPolicyValues): number {
  return breakSteps(settings).findLast((step) => totalMinutes >= step.thresholdMinutes)?.durationMinutes ?? 0;
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

  return computeTimeBreakdown(totalMinutes, automaticBreakMinutes(totalMinutes, settings), targetMinutes);
}

export type AutomaticBreakRange = { breakStart: Date; breakEnd: Date };

/**
 * Where a block's automatic break lies. The steps count the person's presence
 * that day, including `presenceBeforeMinutes` from earlier blocks, as the
 * totals do. Each step reached in this block adds its share of the total and
 * ends where the day reaches its threshold, so beyond nine hours a 30-minute
 * break ends at six hours and 15 more minutes end at nine. A share that would
 * start before the block, or before the previous share ends, starts there
 * instead; one that would not end inside the block is left out.
 */
export function getAutomaticBreakRanges(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  settings: BreakPolicyValues | null | undefined,
  presenceBeforeMinutes = 0,
): AutomaticBreakRange[] {
  if (!start || !end || !settings || settings.breakMode !== 'automatic') {
    return [];
  }

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const blockMinutes = (endMs - startMs) / 60000;
  const ranges: AutomaticBreakRange[] = [];
  let previousDuration = 0;
  let notBeforeMs = startMs;
  for (const step of breakSteps(settings)) {
    const reachedAfterMinutes = step.thresholdMinutes - presenceBeforeMinutes;
    const shareMinutes = step.durationMinutes - previousDuration;
    previousDuration = Math.max(previousDuration, step.durationMinutes);
    // Reached in an earlier block, which shows its share.
    if (reachedAfterMinutes <= 0) continue;
    if (blockMinutes < reachedAfterMinutes) break;
    if (shareMinutes <= 0) continue;
    const breakStartMs = Math.max(notBeforeMs, startMs + (reachedAfterMinutes - shareMinutes) * 60000);
    const breakEndMs = breakStartMs + shareMinutes * 60000;
    if (breakEndMs > endMs) continue;
    ranges.push({ breakStart: new Date(breakStartMs), breakEnd: new Date(breakEndMs) });
    notBeforeMs = breakEndMs;
  }
  return ranges;
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

  if (lastEntry && sameBreakPolicy(lastEntry, nextEntry)) {
    return history;
  }

  return [...history, nextEntry];
}
