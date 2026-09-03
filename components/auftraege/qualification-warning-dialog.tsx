'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  getCoverageStatusLabel,
  type AssignmentApproval,
  type AssignmentEvaluation,
} from '@/lib/qualifications/types';

const CONFIRM_FAILED_MESSAGE =
  'Die begründete Zuweisung konnte nicht gespeichert werden. Bitte versuche es erneut.';

type QualificationWarningDialogProps = {
  evaluation: AssignmentEvaluation | null;
  isSubmitting?: boolean;
  /** Failure of the last confirm attempt, shown inside the still-open dialog. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: (approval: AssignmentApproval) => void | Promise<void>;
};

export function QualificationWarningDialog({
  evaluation,
  isSubmitting = false,
  error = null,
  onCancel,
  onConfirm,
}: QualificationWarningDialogProps) {
  if (!evaluation) return null;

  return (
    <QualificationWarningDialogContent
      key={evaluation.fingerprint}
      evaluation={evaluation}
      isSubmitting={isSubmitting}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function QualificationWarningDialogContent({
  evaluation,
  isSubmitting,
  error,
  onCancel,
  onConfirm,
}: Omit<QualificationWarningDialogProps, 'evaluation'> & {
  evaluation: AssignmentEvaluation;
}) {
  const [reason, setReason] = useState('');
  const [showReasonError, setShowReasonError] = useState(false);
  // Covers a confirm handler that rejects; handlers that report through the
  // `error` prop resolve normally, so only one of the two is ever set.
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const handleConfirm = async () => {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || !evaluation) {
      setShowReasonError(true);
      return;
    }
    setConfirmError(null);
    try {
      await onConfirm({
        fingerprint: evaluation.fingerprint,
        reason: normalizedReason,
      });
    } catch {
      setConfirmError(CONFIRM_FAILED_MESSAGE);
    }
  };

  const uncovered = evaluation.requirementCoverage.filter(
    (coverage) => coverage.status !== 'covered'
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !isSubmitting && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
            Zuweisung prüfen
          </DialogTitle>
          <DialogDescription>
            Die Auswahl deckt nicht alle von deiner Organisation hinterlegten
            Hinweise ab. Die Zuweisung bleibt möglich und wird mit Begründung
            dokumentiert.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {uncovered.map((coverage) => (
            <div
              key={coverage.requirement.id}
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <p className="font-medium">
                {coverage.requirement.capabilityName}
              </p>
              <p className="text-muted-foreground">
                {getCoverageStatusLabel(coverage.status)}
                {coverage.contributor
                  ? ` – stärkster Eintrag: ${coverage.contributor.displayName}`
                  : ''}
              </p>
            </div>
          ))}

          {evaluation.apprenticeWarning.status === 'apprentices_only' && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="font-medium">Ausbildungs-Hinweis</p>
              <p className="text-muted-foreground">
                Die Auswahl besteht ausschließlich aus Personen mit der
                hinterlegten Beschäftigungsart „Ausbildung“.
              </p>
            </div>
          )}
          {evaluation.apprenticeWarning.status === 'incomplete' && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="font-medium">Ausbildungs-Hinweis unvollständig</p>
              <p className="text-muted-foreground">
                Für {evaluation.apprenticeWarning.missingConditionNames.join(', ')}
                {' '}ist keine wirksame Beschäftigungsart hinterlegt.
              </p>
            </div>
          )}

          <Field
            label="Kurze Begründung"
            htmlFor="qualification-override-reason"
            required
            error={showReasonError ? 'Bitte gib eine kurze Begründung ein.' : null}
          >
            <Textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (event.target.value.trim().length >= 3) {
                  setShowReasonError(false);
                }
              }}
              placeholder="z. B. kurzfristiger Notdienst"
              maxLength={500}
              disabled={isSubmitting}
            />
          </Field>

          <ErrorText>{error ?? confirmError}</ErrorText>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Auswahl ändern
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Trotz Hinweis zuweisen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useQualificationWarningConfirmation(): {
  requestApproval: (
    evaluation: AssignmentEvaluation
  ) => Promise<AssignmentApproval | null>;
  warningDialog: React.ReactNode;
} {
  const [evaluation, setEvaluation] = useState<AssignmentEvaluation | null>(
    null
  );
  const resolverRef = useRef<
    ((approval: AssignmentApproval | null) => void) | null
  >(null);

  const requestApproval = useCallback(
    (nextEvaluation: AssignmentEvaluation) =>
      new Promise<AssignmentApproval | null>((resolve) => {
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setEvaluation(nextEvaluation);
      }),
    []
  );

  const finish = useCallback((approval: AssignmentApproval | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setEvaluation(null);
    resolve?.(approval);
  }, []);

  useEffect(
    () => () => {
      resolverRef.current?.(null);
      resolverRef.current = null;
    },
    []
  );

  return {
    requestApproval,
    warningDialog: (
      <QualificationWarningDialog
        evaluation={evaluation}
        onCancel={() => finish(null)}
        onConfirm={(approval) => finish(approval)}
      />
    ),
  };
}
