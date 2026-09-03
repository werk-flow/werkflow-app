'use client'

import { useEffect, useState, type ReactElement } from 'react'
import { usePendingTask } from '@/hooks/use-server-action';
import { useRouter } from 'next/navigation'
import { ClipboardPlus, Loader2 } from 'lucide-react'

import { QualificationWarningDialog } from '@/components/auftraege/qualification-warning-dialog'
import { useBanner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorText } from '@/components/ui/error-text'
import { Field } from '@/components/ui/field'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'
import { applyWorkTemplate, getPublishedWorkTemplates, getWorkTemplatePreview } from '@/lib/work-templates/actions'
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types'
import type { PublishedWorkTemplateOption, WorkTemplateApplicationPreview, WorkTemplateTargetType } from '@/lib/work-templates/types'

type ApplyWorkTemplateCardProps = {
  targetType: WorkTemplateTargetType
  targetId: string
  onApplied?: () => void
}

export function ApplyWorkTemplateCard({
  targetType,
  targetId,
  onApplied,
}: ApplyWorkTemplateCardProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<PublishedWorkTemplateOption[] | null>(null)
  const [versionId, setVersionId] = useState('')
  const [preview, setPreview] = useState<WorkTemplateApplicationPreview | null>(null)
  const [allowAdditional, setAllowAdditional] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null)
  const { run: runPendingTask, isPending } = usePendingTask();
  const { showBanner } = useBanner()
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    let current = true
    getPublishedWorkTemplates(targetType).then((result) => {
      if (!current) return
      if (!result.success) { setOptions([]); setError('Arbeitsvorlagen konnten nicht geladen werden.'); return }
      setOptions(result.data)
    }).catch(() => {
      if (!current) return
      setOptions([])
      setError('Arbeitsvorlagen konnten nicht geladen werden.')
    })
    return () => { current = false }
  }, [open, targetType])

  useEffect(() => {
    if (!versionId) return
    let current = true
    getWorkTemplatePreview({ versionId, targetType, ...(targetType === 'job' ? { jobId: targetId } : { projectId: targetId }) }).then((result) => {
      if (!current) return
      if (!result.success) { setPreview(null); setError('Die Vorschau konnte nicht geladen werden.'); return }
      setPreview(result.data); setAllowAdditional(false); setError(null)
    }).catch(() => {
      if (!current) return
      setPreview(null)
      setError('Die Vorschau konnte nicht geladen werden.')
    })
    return () => { current = false }
  }, [targetId, targetType, versionId])

  function submit(approval?: AssignmentApproval) {
    if (!versionId || !preview) return
    setError(null)
    void runPendingTask(async () => {
      const result = await applyWorkTemplate({ templateVersionId: versionId, ...(targetType === 'job' ? { jobId: targetId } : { projectId: targetId }), allowAdditional, idempotencyKey: `apply-${targetType}-${targetId}-${versionId}`, assignmentApproval: approval ?? null })
      if (!result.success) {
        if ((result.error === 'qualification_warning' || result.error === 'stale_evaluation') && 'evaluation' in result && result.evaluation) { setQualificationWarning(result.evaluation); return }
        const messages: Record<string, string> = {
          work_template_already_applied: 'Diese Version wurde bereits angewendet.',
          work_template_additional_confirmation_required: 'Bestätige zuerst, dass du eine weitere Vorlage ergänzen möchtest.',
          work_template_target_not_incomplete: 'Vorlagen lassen sich nur auf noch nicht abgeschlossene Arbeit anwenden.',
          work_template_reference_unavailable: 'Die Vorlage verweist auf nicht mehr aktive Stammdaten.',
          work_template_version_unavailable: 'Die Vorlage ist nicht mehr verfügbar.',
        }
        if (result.error === 'work_template_reference_unavailable' && 'referenceName' in result && result.referenceName) {
          setError(`„${result.referenceName}“ ist nicht mehr aktiv. Korrigiere die Vorlage und versuche es erneut.`); return
        }
        setError(messages[result.error] ?? 'Die Arbeitsvorlage konnte nicht angewendet werden.'); return
      }
      setQualificationWarning(null); setOpen(false); setVersionId(''); setPreview(null)
      onApplied?.()
      router.refresh()
      showBanner({ variant: 'success', message: 'Arbeitsvorlage wurde als bearbeitbare Planung übernommen.' })
    })
  }

  function openDialog(): void {
    setOptions(null)
    setVersionId('')
    setPreview(null)
    setAllowAdditional(false)
    setError(null)
    setOpen(true)
  }

  return <>
    <div className="rounded-lg border bg-card p-4 sm:p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><ClipboardPlus className="size-4" />Arbeitsvorlage</h3><p className="mt-1 text-sm text-muted-foreground">Ergänzt Aufgaben, Nachweise, Material und Qualifikationen ohne Bestand oder Kalender zu verändern.</p></div><Button type="button" variant="outline" onClick={openDialog}>Vorlage anwenden</Button></div></div>
    <Dialog open={open} onOpenChange={(next) => { if (!isPending) setOpen(next) }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Arbeitsvorlage anwenden</DialogTitle><DialogDescription>Die Inhalte werden in diesen {targetType === 'job' ? 'Auftrag' : 'Projekt'} kopiert und bleiben danach unabhängig von der Vorlage bearbeitbar.</DialogDescription></DialogHeader><DialogBody className="space-y-4 py-1"><Field label="Arbeitsvorlage" htmlFor="apply-work-template-version" required>{options === null ? <Skeleton className="h-9" /> : <SearchableSelect options={options.map((option) => ({ value: option.versionId, label: option.name, description: `Version ${option.versionNumber}` }))} value={versionId} onChange={(value) => { setVersionId(value); setPreview(null); setError(null) }} placeholder="Arbeitsvorlage wählen" searchPlaceholder="Arbeitsvorlagen suchen…" emptyMessage="Keine passende Arbeitsvorlage veröffentlicht" />}</Field>{preview && <div className="rounded-lg border bg-muted/20 p-4 text-sm"><p className="font-medium">{preview.name} · Version {preview.versionNumber}</p><p className="mt-1 text-muted-foreground">{preview.itemCount} Aufgaben/Checklistenpunkte · {preview.evidenceCount} Nachweise · {preview.materialCount} Materialpositionen · {preview.capabilityCount} Qualifikationen · {preview.dependencyCount} Abhängigkeiten</p>{preview.hasSameVersionApplication && <ErrorText className="mt-3">Diese Version wurde bereits angewendet.</ErrorText>}{preview.hasExistingApplication && !preview.hasSameVersionApplication && <label className="mt-3 flex items-start gap-2"><Checkbox checked={allowAdditional} onCheckedChange={(checked) => setAllowAdditional(checked === true)} /><span>Weitere Vorlage ergänzen. Vorhandene Planung bleibt bestehen.</span></label>}</div>}<ErrorText>{error}</ErrorText></DialogBody><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Abbrechen</Button><Button type="button" onClick={() => submit()} disabled={isPending || !preview || preview.hasSameVersionApplication || (preview.hasExistingApplication && !allowAdditional)}>{isPending && <Loader2 className="size-4 animate-spin" />}Anwenden</Button></DialogFooter></DialogContent></Dialog>
    <QualificationWarningDialog evaluation={qualificationWarning} isSubmitting={isPending} onCancel={() => setQualificationWarning(null)} onConfirm={(approval) => submit(approval)} />
  </>
}
