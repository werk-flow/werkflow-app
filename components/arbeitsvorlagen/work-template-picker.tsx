'use client'

import { useEffect, useState, type ReactElement } from 'react'
import Link from 'next/link'

import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'
import { getPublishedWorkTemplates } from '@/lib/work-templates/actions'
import type { PublishedWorkTemplateOption, WorkTemplateTargetType } from '@/lib/work-templates/types'

export function WorkTemplatePicker({ targetType, value, onChange, disabled }: { targetType: WorkTemplateTargetType; value: string; onChange: (value: string) => void; disabled?: boolean }): ReactElement {
  const [options, setOptions] = useState<PublishedWorkTemplateOption[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    getPublishedWorkTemplates(targetType).then((result) => {
      if (!current) return
      if (!result.success) { setFailed(true); setOptions([]); return }
      setFailed(false)
      setOptions(result.data)
    }).catch(() => {
      if (!current) return
      setOptions([])
      setFailed(true)
    })
    return () => { current = false }
  }, [targetType])
  return (
    <div className="grid gap-2">
      <Label htmlFor={`work-template-${targetType}`}>Arbeitsvorlage (optional)</Label>
      {options === null ? <Skeleton className="h-9 w-full" /> : <SearchableSelect id={`work-template-${targetType}`} options={options.map((option) => ({ value: option.versionId, label: option.name, description: `Version ${option.versionNumber}${option.description ? ` · ${option.description}` : ''}` }))} value={value} onChange={onChange} allowNone noneLabel="Ohne Arbeitsvorlage" placeholder="Arbeitsvorlage wählen" searchPlaceholder="Arbeitsvorlagen suchen…" emptyMessage="Keine veröffentlichte Arbeitsvorlage" disabled={disabled} />}
      {failed ? <p className="text-xs text-destructive">Arbeitsvorlagen konnten nicht geladen werden.</p> : options?.length === 0 ? <p className="text-xs text-muted-foreground">Noch keine passende Vorlage veröffentlicht. <Link href="/arbeitsvorlagen" className="text-primary underline-offset-2 hover:underline">Arbeitsvorlagen verwalten</Link></p> : <p className="text-xs text-muted-foreground">Die Inhalte werden als bearbeitbare Planung übernommen. Bestand und Kalender bleiben unverändert.</p>}
    </div>
  )
}
