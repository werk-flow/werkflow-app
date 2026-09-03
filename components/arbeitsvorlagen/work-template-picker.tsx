'use client'

import { useEffect, useState, type ReactElement } from 'react'
import Link from 'next/link'

import { Field } from '@/components/ui/field'
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
    <Field
      label="Arbeitsvorlage (optional)"
      htmlFor={`work-template-${targetType}`}
      error={failed ? 'Arbeitsvorlagen konnten nicht geladen werden.' : null}
      description={failed ? undefined : options?.length === 0 ? <>Noch keine passende Vorlage veröffentlicht. <Link href="/arbeitsvorlagen" className="text-primary underline-offset-2 hover:underline">Arbeitsvorlagen verwalten</Link></> : 'Die Inhalte werden als bearbeitbare Planung übernommen. Bestand und Kalender bleiben unverändert.'}
    >
      {options === null ? <Skeleton className="h-9 w-full" /> : <SearchableSelect options={options.map((option) => ({ value: option.versionId, label: option.name, description: `Version ${option.versionNumber}${option.description ? ` · ${option.description}` : ''}` }))} value={value} onChange={onChange} allowNone noneLabel="Ohne Arbeitsvorlage" placeholder="Arbeitsvorlage wählen" searchPlaceholder="Arbeitsvorlagen suchen…" emptyMessage="Keine veröffentlichte Arbeitsvorlage" disabled={disabled} />}
    </Field>
  )
}
