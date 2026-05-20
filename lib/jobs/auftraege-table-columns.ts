import { z } from 'zod'

import type { Json } from '@/lib/supabase/database.types'
import type { SortColumn } from '@/lib/jobs/types'

export const AUFTRAEGE_COLUMN_IDS = [
  'nr',
  'bezeichnung',
  'kunde',
  'status',
  'prioritaet',
  'mitarbeiter',
  'datum',
] as const

export type AuftraegeColumnId = (typeof AUFTRAEGE_COLUMN_IDS)[number]

export const AUFTRAEGE_VISIBLE_COLUMN_LABELS: Record<AuftraegeColumnId, string> = {
  nr: 'Auftragsnummer',
  bezeichnung: 'Titel',
  kunde: 'Kunde',
  status: 'Status',
  prioritaet: 'Priorität',
  mitarbeiter: 'Mitarbeiter',
  datum: 'Datum',
}

export const AUFTRAEGE_TABLE_COLUMNS: Array<{
  id: AuftraegeColumnId
  label: string
  sortable: boolean
}> = AUFTRAEGE_COLUMN_IDS.map((id) => ({
  id,
  label: AUFTRAEGE_VISIBLE_COLUMN_LABELS[id],
  sortable: id !== 'mitarbeiter',
}))

export const DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS: AuftraegeColumnId[] = [
  ...AUFTRAEGE_COLUMN_IDS,
]

const visibleColumnsSchema = z.object({
  visibleColumns: z
    .array(z.enum(AUFTRAEGE_COLUMN_IDS))
    .min(1, 'Bitte wähle mindestens eine Spalte aus.')
    .transform((value) => Array.from(new Set(value))),
})

export type AuftraegeColumnPreferencesValues = z.infer<typeof visibleColumnsSchema>

export const auftraegeColumnPreferencesSchema = visibleColumnsSchema

type RawPreferenceShape = {
  auftraege?: {
    visibleColumns?: unknown
  }
}

export function parseVisibleAuftraegeColumns(value: unknown): AuftraegeColumnId[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS]
  }

  const parsed = value.filter((entry): entry is AuftraegeColumnId =>
    AUFTRAEGE_COLUMN_IDS.includes(entry as AuftraegeColumnId)
  )

  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS]
}

export function getAuftraegePreferencesFromJson(
  preferences: Json | null | undefined
): AuftraegeColumnId[] {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return [...DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS]
  }

  const typedPreferences = preferences as RawPreferenceShape
  return parseVisibleAuftraegeColumns(typedPreferences.auftraege?.visibleColumns)
}

export function buildAuftraegePreferencesJson(
  visibleColumns: AuftraegeColumnId[],
  previousPreferences: Json | null | undefined
): Json {
  const basePreferences =
    previousPreferences && typeof previousPreferences === 'object' && !Array.isArray(previousPreferences)
      ? { ...(previousPreferences as Record<string, Json | undefined>) }
      : {}

  const previousAuftraege =
    basePreferences.auftraege &&
    typeof basePreferences.auftraege === 'object' &&
    !Array.isArray(basePreferences.auftraege)
      ? { ...(basePreferences.auftraege as Record<string, Json | undefined>) }
      : {}

  return {
    ...basePreferences,
    auftraege: {
      ...previousAuftraege,
      visibleColumns,
    },
  }
}

export function resolveVisibleAuftraegeColumns(
  visibleColumns: AuftraegeColumnId[],
  options?: {
    hideClientColumn?: boolean
  }
): AuftraegeColumnId[] {
  const uniqueColumns = Array.from(new Set(visibleColumns))
  const filteredColumns = options?.hideClientColumn
    ? uniqueColumns.filter((column) => column !== 'kunde')
    : uniqueColumns

  if (filteredColumns.length > 0) {
    return filteredColumns
  }

  return options?.hideClientColumn
    ? DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS.filter((column) => column !== 'kunde')
    : [...DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS]
}

export function isAuftraegeColumnVisible(
  visibleColumns: AuftraegeColumnId[],
  columnId: AuftraegeColumnId
): boolean {
  return visibleColumns.includes(columnId)
}

export function getVisibleSortableColumns(
  visibleColumns: AuftraegeColumnId[]
): SortColumn[] {
  return visibleColumns.filter(
    (column): column is SortColumn => column !== 'mitarbeiter'
  )
}

export function resolveAuftraegeSortColumn(
  currentSortColumn: SortColumn,
  visibleColumns: AuftraegeColumnId[]
): SortColumn {
  const visibleSortableColumns = getVisibleSortableColumns(visibleColumns)

  if (visibleSortableColumns.includes(currentSortColumn)) {
    return currentSortColumn
  }

  return visibleSortableColumns[0] ?? 'datum'
}
