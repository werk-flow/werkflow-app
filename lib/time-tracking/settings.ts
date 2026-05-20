import { z } from 'zod'

import type { Database, Json } from '@/lib/supabase/database.types'
import { computeTimeBreakdown, type TimeBreakdown } from '@/lib/time-tracking/helpers'

export type OrgBreakMode = Database['public']['Enums']['time_tracking_break_mode']

export const DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES = 360
export const DEFAULT_AUTO_BREAK_DURATION_MINUTES = 30

export const BREAK_MODE_OPTIONS: Array<{
  value: OrgBreakMode
  label: string
  description: string
}> = [
  {
    value: 'manual',
    label: 'Pause manuell stempeln',
    description:
      'Mitarbeiter starten und beenden ihre Pausen weiterhin selbst per Pause-Button.',
  },
  {
    value: 'automatic',
    label: 'Pause automatisch abziehen',
    description:
      'Sobald die konfigurierte Arbeitszeit erreicht ist, wird die feste Pausenzeit automatisch abgezogen.',
  },
]

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
      })
    }
  })

export type TimeTrackingSettingsValues = z.infer<typeof timeTrackingSettingsSchema>

const breakPolicyHistoryEntrySchema = z.object({
  breakMode: z.enum(['manual', 'automatic']),
  autoBreakThresholdMinutes: z.number().int().min(1).max(1440),
  autoBreakDurationMinutes: z.number().int().min(0).max(1440),
  effectiveFrom: z.string().datetime(),
})

export type BreakPolicyHistoryEntry = z.infer<typeof breakPolicyHistoryEntrySchema>

export type OrganizationTimeTrackingSettings = {
  organizationId: string
  breakMode: OrgBreakMode
  autoBreakThresholdMinutes: number
  autoBreakDurationMinutes: number
  breakPolicyHistory: BreakPolicyHistoryEntry[]
}

export function getDefaultTimeTrackingSettings(
  organizationId: string
): OrganizationTimeTrackingSettings {
  return {
    organizationId,
    breakMode: 'manual',
    autoBreakThresholdMinutes: DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES,
    autoBreakDurationMinutes: DEFAULT_AUTO_BREAK_DURATION_MINUTES,
    breakPolicyHistory: [],
  }
}

export function buildBreakPolicyHistoryEntry(
  values: Pick<
    OrganizationTimeTrackingSettings,
    'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'
  >,
  effectiveFrom = new Date().toISOString()
): BreakPolicyHistoryEntry {
  return {
    breakMode: values.breakMode,
    autoBreakThresholdMinutes: values.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: values.autoBreakDurationMinutes,
    effectiveFrom,
  }
}

export function parseBreakPolicyHistory(value: Json | null | undefined): BreakPolicyHistoryEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => breakPolicyHistoryEntrySchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort(
      (a, b) =>
        new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime()
    )
}

export function normalizeTimeTrackingSettings(
  input: Partial<OrganizationTimeTrackingSettings> & { organizationId: string }
): OrganizationTimeTrackingSettings {
  return {
    organizationId: input.organizationId,
    breakMode: input.breakMode ?? 'manual',
    autoBreakThresholdMinutes:
      input.autoBreakThresholdMinutes ?? DEFAULT_AUTO_BREAK_THRESHOLD_MINUTES,
    autoBreakDurationMinutes:
      input.autoBreakDurationMinutes ?? DEFAULT_AUTO_BREAK_DURATION_MINUTES,
    breakPolicyHistory: input.breakPolicyHistory ?? [],
  }
}

export function resolveBreakPolicyAtTimestamp(
  settings: OrganizationTimeTrackingSettings,
  referenceTimestamp?: string | Date | null
): Pick<
  OrganizationTimeTrackingSettings,
  'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'
> {
  const history = settings.breakPolicyHistory

  if (history.length === 0 || !referenceTimestamp) {
    return {
      breakMode: settings.breakMode,
      autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
    }
  }

  const referenceMs =
    referenceTimestamp instanceof Date
      ? referenceTimestamp.getTime()
      : new Date(referenceTimestamp).getTime()

  if (!Number.isFinite(referenceMs)) {
    return {
      breakMode: settings.breakMode,
      autoBreakThresholdMinutes: settings.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: settings.autoBreakDurationMinutes,
    }
  }

  const matchingEntry =
    [...history]
      .reverse()
      .find((entry) => new Date(entry.effectiveFrom).getTime() <= referenceMs) ??
    history[0]

  return {
    breakMode: matchingEntry.breakMode,
    autoBreakThresholdMinutes: matchingEntry.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: matchingEntry.autoBreakDurationMinutes,
  }
}

export function computeBreakdownForSettings(
  totalMinutes: number,
  trackedBreakMinutes: number,
  settings:
    | Pick<
        OrganizationTimeTrackingSettings,
        'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'
      >
    | null
    | undefined
): TimeBreakdown {
  if (!settings || settings.breakMode === 'manual') {
    return computeTimeBreakdown(totalMinutes, trackedBreakMinutes)
  }

  const breakMinutes =
    totalMinutes >= settings.autoBreakThresholdMinutes
      ? settings.autoBreakDurationMinutes
      : 0

  return computeTimeBreakdown(totalMinutes, breakMinutes)
}

export function getAutomaticBreakRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  settings:
    | Pick<
        OrganizationTimeTrackingSettings,
        'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'
      >
    | null
    | undefined
): { breakStart: Date; breakEnd: Date } | null {
  if (
    !start ||
    !end ||
    !settings ||
    settings.breakMode !== 'automatic' ||
    settings.autoBreakDurationMinutes <= 0
  ) {
    return null
  }

  const startDate = start instanceof Date ? start : new Date(start)
  const endDate = end instanceof Date ? end : new Date(end)
  const startMs = startDate.getTime()
  const endMs = endDate.getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null
  }

  const totalMinutes = (endMs - startMs) / 60000
  if (totalMinutes < settings.autoBreakThresholdMinutes) {
    return null
  }

  const breakEnd = new Date(startMs + settings.autoBreakThresholdMinutes * 60000)
  const breakStart = new Date(
    breakEnd.getTime() - settings.autoBreakDurationMinutes * 60000
  )

  if (breakStart <= startDate || breakEnd > endDate) {
    return null
  }

  return { breakStart, breakEnd }
}

export function appendBreakPolicyHistory(
  history: BreakPolicyHistoryEntry[],
  nextEntry: BreakPolicyHistoryEntry
): BreakPolicyHistoryEntry[] {
  const lastEntry = history[history.length - 1]

  if (
    lastEntry &&
    lastEntry.breakMode === nextEntry.breakMode &&
    lastEntry.autoBreakThresholdMinutes === nextEntry.autoBreakThresholdMinutes &&
    lastEntry.autoBreakDurationMinutes === nextEntry.autoBreakDurationMinutes
  ) {
    return history
  }

  return [...history, nextEntry]
}
