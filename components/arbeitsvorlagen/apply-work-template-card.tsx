'use client';

import { type ReactElement } from 'react';
import { ClipboardPlus, Loader2 } from 'lucide-react';

import { QualificationWarningDialog } from '@/components/auftraege/shared/qualification-warning-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkTemplateTargetType } from '@/lib/work-templates/types';

import { useApplyWorkTemplate } from './use-apply-work-template';
import { SectionTitle } from '@/components/shared/section-title';

type ApplyWorkTemplateCardProps = {
  targetType: WorkTemplateTargetType;
  targetId: string;
  onApplied?: () => void;
};

export function ApplyWorkTemplateCard({
  targetType,
  targetId,
  onApplied,
}: ApplyWorkTemplateCardProps): ReactElement {
  const {
    open,
    setOpen,
    options,
    versionId,
    preview,
    allowAdditional,
    setAllowAdditional,
    error,
    loadError,
    retryLoad,
    qualificationWarning,
    setQualificationWarning,
    isPending,
    previewPending,
    selectVersion,
    submit,
    openDialog,
  } = useApplyWorkTemplate({ targetType, targetId, onApplied });

  return (
    <>
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <SectionTitle icon={<ClipboardPlus className="size-4" />}>Arbeitsvorlage</SectionTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Ergänzt Aufgaben, Nachweise, Material und Qualifikationen ohne Bestand oder Kalender zu
              verändern.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={openDialog}>
            Vorlage anwenden
          </Button>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen} pending={isPending}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Arbeitsvorlage anwenden</DialogTitle>
            <DialogDescription>
              Die Inhalte werden in diesen {targetType === 'job' ? 'Auftrag' : 'Projekt'} kopiert und bleiben
              danach unabhängig von der Vorlage bearbeitbar.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Arbeitsvorlage" htmlFor="apply-work-template-version" required>
              {options === null ? (
                <Skeleton className="h-9" />
              ) : (
                <SearchableSelect
                  options={options.map((option) => ({
                    value: option.versionId,
                    label: option.name,
                    description: `Version ${option.versionNumber}`,
                  }))}
                  value={versionId}
                  onChange={selectVersion}
                  placeholder="Arbeitsvorlage wählen"
                  searchPlaceholder="Arbeitsvorlagen suchen…"
                  emptyMessage="Keine passende Arbeitsvorlage veröffentlicht"
                />
              )}
            </Field>
            {previewPending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <InlinePending active label="Vorschau wird geladen" />
                Vorschau wird geladen…
              </p>
            )}
            {preview && (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <p className="font-medium">
                  {preview.name} · Version {preview.versionNumber}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {preview.itemCount} Aufgaben/Checklistenpunkte · {preview.evidenceCount} Nachweise ·{' '}
                  {preview.materialCount} Materialpositionen · {preview.capabilityCount} Qualifikationen ·{' '}
                  {preview.dependencyCount} Abhängigkeiten
                </p>
                {preview.hasSameVersionApplication && (
                  <ErrorText className="mt-3">Diese Version wurde bereits angewendet.</ErrorText>
                )}
                {preview.hasExistingApplication && !preview.hasSameVersionApplication && (
                  <label className="mt-3 flex items-start gap-2">
                    <Checkbox
                      checked={allowAdditional}
                      onCheckedChange={(checked) => setAllowAdditional(checked === true)}
                    />
                    <span>Weitere Vorlage ergänzen. Vorhandene Planung bleibt bestehen.</span>
                  </label>
                )}
              </div>
            )}
            {loadError && <SectionError onRetry={retryLoad}>{loadError}</SectionError>}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="button" onClick={() => submit()} disabled={isPending || previewPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}Anwenden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QualificationWarningDialog
        evaluation={qualificationWarning}
        isSubmitting={isPending}
        onCancel={() => setQualificationWarning(null)}
        onConfirm={(approval) => submit(approval)}
      />
    </>
  );
}
