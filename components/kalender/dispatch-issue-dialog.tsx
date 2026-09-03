'use client';

// P1-12: issuing a dispatch. Shows the honest readiness picture (ok/warning/
// unknown per dimension — unknown is never styled as success) before the
// manager sends the work instruction. Issuing sends NO customer message.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleCheck, CircleHelp, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { getPlanningOptions } from '@/lib/planning/actions';
import {
  issueDispatch,
  previewDispatchReadiness,
} from '@/lib/dispatch/actions';
import {
  dispatchErrorMessage,
  type ReadinessResult,
} from '@/lib/dispatch/types';

type EmployeeOption = {
  employeeRecordId: string;
  userId: string | null;
  label: string;
};

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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [options, setOptions] = useState<EmployeeOption[]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const readinessResult = await previewDispatchReadiness(
          jobId !== null ? { jobId } : { occurrenceId: occurrenceId! }
        );
        if (cancelled) return;
        if (!readinessResult.success) {
          setLoadError(dispatchErrorMessage(readinessResult.error));
          return;
        }
        setReadiness(readinessResult.readiness);
        if (isJobTarget) {
          const optionsResult = await getPlanningOptions();
          if (cancelled) return;
          if (!optionsResult.success) {
            setLoadError(dispatchErrorMessage(optionsResult.error));
            return;
          }
          const employeeOptions = optionsResult.employees.map((employee) => ({
            employeeRecordId: employee.employeeRecordId,
            userId: employee.userId,
            label:
              [employee.firstName, employee.lastName]
                .filter(Boolean)
                .join(' ') || 'Unbenannt',
          }));
          setOptions(employeeOptions);
          const preselectedUserIds = new Set(defaultRecipientUserIds ?? []);
          setSelectedRecordIds(
            employeeOptions
              .filter(
                (option) =>
                  option.userId && preselectedUserIds.has(option.userId)
              )
              .map((option) => option.employeeRecordId)
          );
        }
      } catch {
        if (!cancelled) setLoadError(dispatchErrorMessage('load_failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disabled only while the readiness check or the send is in flight; a
  // missing recipient is reported on submit, not by greying the button.
  const canSubmit = useMemo(
    () => readiness !== null && !isSubmitting,
    [readiness, isSubmitting]
  );

  const handleSubmit = async () => {
    setSubmitError(null);
    if (isJobTarget && selectedRecordIds.length === 0) {
      setSubmitError('Bitte wähle mindestens eine Person als Empfänger aus.');
      document
        .querySelector<HTMLElement>('#dispatch-recipients [role="checkbox"]')
        ?.focus();
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Einsatz senden</DialogTitle>
          <DialogDescription>
            Die zugewiesenen Personen sehen den Einsatz und bestätigen ihn.
            Es wird keine Nachricht an Kunden versendet.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <ErrorText>{loadError}</ErrorText>
        ) : !readiness ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Bereitschaft wird geprüft …
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
                        className="size-4 text-green-600 dark:text-green-400"
                        data-readiness-icon="ok"
                        aria-hidden="true"
                      />
                    ) : dimension.state === 'warning' ? (
                      <AlertTriangle
                        className="size-4 text-yellow-600 dark:text-yellow-400"
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
                      <span className="text-xs font-normal text-muted-foreground">
                        (nicht bewertet)
                      </span>
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
              <fieldset id="dispatch-recipients" className="space-y-2">
                <legend className="text-sm font-medium">Empfänger</legend>
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-2">
                  {options.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Keine Personen verfügbar.
                    </p>
                  )}
                  {options.map((option) => (
                    <label
                      key={option.employeeRecordId}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selectedRecordIds.includes(
                          option.employeeRecordId
                        )}
                        onCheckedChange={(checked) =>
                          setSelectedRecordIds((previous) =>
                            checked
                              ? [...previous, option.employeeRecordId]
                              : previous.filter(
                                  (id) => id !== option.employeeRecordId
                                )
                          )
                        }
                        aria-label={`${option.label} als Empfänger auswählen`}
                      />
                      <span>
                        {option.label}
                        {!option.userId && (
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            (ohne Zugang)
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
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
          <Button variant="outline" onClick={onClose}>
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
