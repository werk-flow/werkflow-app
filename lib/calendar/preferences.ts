import { z } from 'zod';
import type { Json } from '@/lib/supabase/database.types';

/**
 * Per-user calendar preferences (P1-24a, criterion 20), stored under the
 * `calendar` key of `organization_user_preferences.preferences` beside the
 * Aufträge column preferences. Parsing is lenient on purpose: an old or
 * damaged value falls back field by field to the defaults, so a preference
 * can never break the calendar.
 */

export const CALENDAR_HORIZON_WEEKS = [1, 2, 4, 6] as const;
export type CalendarHorizonWeeks = (typeof CALENDAR_HORIZON_WEEKS)[number];

export const CALENDAR_DISPATCH_FILTERS = ['nicht_gesendet', 'ausstehend', 'bestaetigt', 'rueckfrage', 'nicht_moeglich'] as const;

export const calendarPreferencesSchema = z.object({
  view: z.enum(['day', 'week', 'month']).nullable(),
  horizonWeeks: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6)]),
  density: z.enum(['compact', 'comfortable']),
  hideWeekends: z.boolean(),
  readOnly: z.boolean(),
  /** null follows the horizon: on for one week, off for longer horizons. */
  showActualTime: z.boolean().nullable(),
  showJobs: z.boolean(),
  /** null means every member; a list is the explicit selection. */
  memberUserIds: z.array(z.string().max(64)).max(500).nullable(),
  teamIds: z.array(z.string().max(64)).max(100),
  dispatchStates: z.array(z.enum(CALENDAR_DISPATCH_FILTERS)).max(5),
  onlyConflicts: z.boolean(),
  search: z.string().max(120),
});

export type CalendarPreferences = z.infer<typeof calendarPreferencesSchema>;

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  view: null,
  horizonWeeks: 1,
  density: 'comfortable',
  hideWeekends: false,
  readOnly: false,
  showActualTime: null,
  showJobs: true,
  memberUserIds: null,
  teamIds: [],
  dispatchStates: [],
  onlyConflicts: false,
  search: '',
};

const CALENDAR_KEY = 'calendar';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Field-by-field lenient read: every invalid field takes its default. */
export function readCalendarPreferences(preferences: Json | null | undefined): CalendarPreferences {
  if (!isJsonObject(preferences)) return DEFAULT_CALENDAR_PREFERENCES;
  const stored = preferences[CALENDAR_KEY];
  if (!isJsonObject(stored)) return DEFAULT_CALENDAR_PREFERENCES;
  const result: Record<string, unknown> = { ...DEFAULT_CALENDAR_PREFERENCES };
  for (const [key, fieldSchema] of Object.entries(calendarPreferencesSchema.shape)) {
    const parsed = fieldSchema.safeParse(stored[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return calendarPreferencesSchema.parse(result);
}

/** The JSON to store: the other preference keys stay untouched. */
export function writeCalendarPreferencesJson(current: Json | null | undefined, preferences: CalendarPreferences): Json {
  const base = isJsonObject(current) ? current : {};
  return { ...base, [CALENDAR_KEY]: preferences } as Json;
}

/** The actual-time toggle's effective value when the user has not chosen one. */
export function resolveShowActualTime(preferences: Pick<CalendarPreferences, 'showActualTime' | 'horizonWeeks'>): boolean {
  return preferences.showActualTime ?? preferences.horizonWeeks === 1;
}
