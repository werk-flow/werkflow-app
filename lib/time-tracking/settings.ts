import { z } from '@/lib/zod';

import type { Database, Json } from '@/lib/supabase/database.types';
import { computeTimeBreakdown, type TimeBreakdown } from '@/lib/time-tracking/helpers';

export type OrgBreakMode = Database['public']['Enums']['time_tracking_break_mode'];

const DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES = 360;
const DEFAULT_AUTO_BREAK_DURATION_MINUTES = 30;

/** One step of the automatic break: from this much presence, this much break in total. */
export type BreakStep = { thresholdMinutes: number; durationMinutes: number };

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
 * Where a block sits in its day's presence that counts toward the automatic
 * break: the totals count the day's work without standby, and so does the
 * calendar. The minutes of the same person's earlier and later shown blocks
 * that day, and of the blocks too short to show, which still count toward
 * the steps. A block that does not count (standby) shows no automatic break.
 */
export type BreakDayPosition = {
  countsTowardBreak: boolean;
  beforeMinutes: number;
  afterMinutes: number;
  hiddenMinutes: number;
};

const ONLY_BLOCK_OF_THE_DAY: BreakDayPosition = {
  countsTowardBreak: true,
  beforeMinutes: 0,
  afterMinutes: 0,
  hiddenMinutes: 0,
};

/**
 * Where a block's automatic break lies. Each step the day reaches adds its
 * share of the total as a span of the day's shown counted presence that ends
 * at the step's threshold, or earlier where the shown presence or the next
 * share begins (blocks too short to show can carry the day past a
 * threshold): beyond nine hours, 30 minutes up to six hours and 15 more up
 * to nine. The block shows the part of each span
 * that falls in its own presence, so the blocks of a day add up to the break
 * the totals deduct, however the day is split.
 */
export function getAutomaticBreakRanges(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  settings: BreakPolicyValues | null | undefined,
  position: BreakDayPosition = ONLY_BLOCK_OF_THE_DAY,
): AutomaticBreakRange[] {
  if (!start || !end || !settings || settings.breakMode !== 'automatic' || !position.countsTowardBreak) {
    return [];
  }

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const blockFrom = position.beforeMinutes;
  const blockTo = blockFrom + (endMs - startMs) / 60000;
  const shownDayMinutes = blockTo + position.afterMinutes;
  const reachedDayMinutes = shownDayMinutes + position.hiddenMinutes;
  // Each reached step's share of the total, in threshold order.
  const shares: Array<{ thresholdMinutes: number; shareMinutes: number }> = [];
  let previousDuration = 0;
  for (const step of breakSteps(settings)) {
    if (reachedDayMinutes < step.thresholdMinutes) break;
    const shareMinutes = step.durationMinutes - previousDuration;
    previousDuration = Math.max(previousDuration, step.durationMinutes);
    if (shareMinutes > 0) shares.push({ thresholdMinutes: step.thresholdMinutes, shareMinutes });
  }
  // Laid out from the last share back: each ends at its threshold, or where
  // the shown presence or the next share begins, so no minute is lost.
  const spans: Array<{ from: number; to: number }> = [];
  let nextFrom = shownDayMinutes;
  for (const share of [...shares].reverse()) {
    const to = Math.min(share.thresholdMinutes, nextFrom);
    const from = Math.max(to - share.shareMinutes, 0);
    spans.unshift({ from, to });
    nextFrom = from;
  }
  const ranges: AutomaticBreakRange[] = [];
  for (const span of spans) {
    const spanFrom = Math.max(blockFrom, span.from);
    const spanTo = Math.min(blockTo, span.to);
    if (spanTo <= spanFrom) continue;
    ranges.push({
      breakStart: new Date(startMs + (spanFrom - blockFrom) * 60000),
      breakEnd: new Date(startMs + (spanTo - blockFrom) * 60000),
    });
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
