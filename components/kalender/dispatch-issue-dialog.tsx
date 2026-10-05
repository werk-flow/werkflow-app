'use client';

// P1-12: issuing a dispatch. Shows the honest readiness picture (ok/warning/
// unknown per dimension — unknown is never styled as success) before the
// manager sends the work instruction. Issuing sends NO customer message.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleCheck, CircleHelp, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { usePlanningOptions } from '@/hooks/use-planning-options';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { issueDispatch, previewDispatchReadiness } from '@/lib/dispatch/actions';
import { dispatchErrorMessage, type ReadinessResult } from '@/lib/dispatch/types';

export function DispatchIssueDialog({
  target,
  defaultRecipientUserIds,
  onClose,
  onIssued,
}: {
  target: { occurrenceId: string } | { jobId: string };
  /** Preselection for job-targeted dispatches (user ids of job assignees). */
  defaultRecipientUserIds?: string[];
  onClose: () => void;
  onIssued: () => void;
}) {
  const occurrenceId = 'occurrenceId' in target ? target.occurrenceId : null;
  const jobId = 'jobId' in target ? target.jobId : null;
  const isJobTarget = jobId !== null;
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readinessReloadCount, setReadinessReloadCount] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Null until the user changes the recipients; before that the resolved defaults apply.
  const [chosenRecordIds, setSelectedRecordIds] = useState<string[] | null>(null);
  const employeeSearch = usePlanningOptions(
    'employees',
    chosenRecordIds,
    defaultRecipientUserIds ?? [],
    isJobTarget,
  );
  const selectedRecordIds = employeeSearch.selectedIds;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const readinessResult = await previewDispatchReadiness(
          'jobId' in target ? { jobId: target.jobId } : { occurrenceId: target.occurrenceId },
        );
        if (cancelled) return;
        if (!readinessResult.success) {
          setLoadError(dispatchErrorMessage(readinessResult.error));
          return;
        }
        setReadiness(readinessResult.readiness);
      } catch {
        if (!cancelled) setLoadError(dispatchErrorMessage('load_failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one readiness load when the dialog mounts and one per retry; later changes go through its own actions
  }, [readinessReloadCount]);

  // Disabled only while the readiness check or the send is in flight; a
  // missing recipient is reported on submit, not by greying the button.
  const canSubmit = useMemo(
    () => readiness !== null && !isSubmitting && !employeeSearch.resolvingDefaults,
    [readiness, isSubmitting, employeeSearch.resolvingDefaults],
  );

  const handleSubmit = async () => {
    setSubmitError(null);
    if (isJobTarget && selectedRecordIds.length === 0) {
      setSubmitError('Bitte wähle mindestens eine Person als Empfänger aus.');
      document.querySelector<HTMLElement>('#dispatch-recipients')?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await issueDispatch({
        occurrenceId,
        jobId,
        recipientEmployeeRecordIds: isJobTarget ? selectedRecordIds : null,
        note: note.trim() || null,
        requestId,
      });
      if (!result.success) {
        setSubmitError(dispatchErrorMessage(result.error));
        return;
      }
      onIssued();
    } catch {
      setSubmitError(dispatchErrorMessage('unexpected_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isSubmitting}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Einsatz senden</DialogTitle>
          <DialogDescription>
            Die zugewiesenen Personen sehen den Einsatz und bestätigen ihn. Es wird keine Nachricht an Kunden
            versendet.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <SectionError
            onRetry={() => {
              setLoadError(null);
              setReadinessReloadCount((count) => count + 1);
            }}
          >
            {loadError}
          </SectionError>
        ) : !readiness ? (
          <div className="space-y-2" role="status" aria-busy="true">
            <span className="sr-only">Bereitschaft wird geprüft.</span>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="space-y-2 rounded-md border bg-muted/30 px-3 py-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {readiness.dimensions.map((dimension) => (
                <li
                  key={dimension.key}
                  className="rounded-md border bg-muted/30 px-3 py-2"
                  data-readiness-key={dimension.key}
                  data-readiness-state={dimension.state}
                >
                  <p className="flex items-center gap-1.5 font-medium">
                    {dimension.state === 'ok' ? (
                      <CircleCheck
                        className="size-4 text-success-text"
                        data-readiness-icon="ok"
                        aria-hidden="true"
                      />
                    ) : dimension.state === 'warning' ? (
                      <AlertTriangle
                        className="size-4 text-warning-text"
                        data-readiness-icon="warning"
                        aria-hidden="true"
                      />
                    ) : (
                      <CircleHelp
                        className="size-4 text-muted-foreground"
                        data-readiness-icon="unknown"
                        aria-hidden="true"
                      />
                    )}
                    {dimension.label}
                    {dimension.state === 'unknown' && (
                      <span className="text-xs font-normal text-muted-foreground">(nicht bewertet)</span>
                    )}
                  </p>
                  {dimension.details.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {dimension.details.map((detail, index) => (
                        <li key={index}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            {isJobTarget && (
              <Field label="Empfänger" htmlFor="dispatch-recipients" error={employeeSearch.select.loadError}>
                <SearchableMultiSelect
                  {...employeeSearch.select}
                  selectedIds={selectedRecordIds}
                  onSelectionChange={setSelectedRecordIds}
                  placeholder="Empfänger auswählen"
                  searchPlaceholder="Mitarbeiter suchen …"
                  emptyMessage="Keine Personen verfügbar"
                />
              </Field>
            )}

            <Field label="Hinweis (optional)" htmlFor="dispatch-note">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="z. B. Schlüssel beim Hausmeister abholen"
                maxLength={2000}
              />
            </Field>
          </>
        )}

        <ErrorText>{submitError}</ErrorText>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Abbrechen
          </Button>
          <Button disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Einsatz senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
