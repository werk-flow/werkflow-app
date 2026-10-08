'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import {
  getCoverageStatusLabel,
  type AssignmentApproval,
  type AssignmentEvaluation,
} from '@/lib/qualifications/types';

const REASON_FIELD_ID = 'qualification-override-reason';
const REASON_MISSING_MESSAGE = 'Bitte gib eine kurze Begründung ein.';

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
  isSubmitting = false,
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
    const reasonError = normalizedReason.length < 3 ? REASON_MISSING_MESSAGE : undefined;
    if (focusFirstInvalidField({ [REASON_FIELD_ID]: reasonError })) {
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

  const uncovered = evaluation.requirementCoverage.filter((coverage) => coverage.status !== 'covered');

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()} pending={isSubmitting}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning-text" />
            Zuweisung prüfen
          </DialogTitle>
          <DialogDescription>
            Die Auswahl deckt nicht alle von deiner Organisation hinterlegten Hinweise ab. Die Zuweisung
            bleibt möglich und wird mit Begründung dokumentiert.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* Own wrapper so only the gap rows form the list; the same
              space-y-3 keeps the spacing identical, and no empty wrapper
              renders without gaps. */}
          {uncovered.length > 0 && (
            <div className="space-y-3" role="list" aria-label="Offene Qualifikationshinweise">
              {uncovered.map((coverage) => (
                <div
                  key={coverage.requirement.id}
                  role="listitem"
                  aria-label={coverage.requirement.capabilityName}
                  className="rounded-md border bg-muted/30 px-3 py-2"
                >
                  <p className="font-medium">{coverage.requirement.capabilityName}</p>
                  <p className="text-muted-foreground">
                    {getCoverageStatusLabel(coverage.status)}
                    {coverage.contributor ? ` – stärkster Eintrag: ${coverage.contributor.displayName}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}

          {evaluation.apprenticeWarning.status === 'apprentices_only' && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="font-medium">Ausbildungs-Hinweis</p>
              <p className="text-muted-foreground">
                Die Auswahl besteht ausschließlich aus Personen mit der hinterlegten Beschäftigungsart
                „Ausbildung“.
              </p>
            </div>
          )}
          {evaluation.apprenticeWarning.status === 'incomplete' && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="font-medium">Ausbildungs-Hinweis unvollständig</p>
              <p className="text-muted-foreground">
                Für {evaluation.apprenticeWarning.missingConditionNames.join(', ')} ist keine wirksame
                Beschäftigungsart hinterlegt.
              </p>
            </div>
          )}

          <Field
            label="Kurze Begründung"
            htmlFor={REASON_FIELD_ID}
            required
            error={showReasonError ? REASON_MISSING_MESSAGE : null}
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
          <Button pending={isSubmitting} onClick={() => void handleConfirm()} disabled={isSubmitting}>
            Trotz Hinweis zuweisen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useQualificationWarningConfirmation(): {
  requestApproval: (evaluation: AssignmentEvaluation) => Promise<AssignmentApproval | null>;
  warningDialog: React.ReactNode;
} {
  const [evaluation, setEvaluation] = useState<AssignmentEvaluation | null>(null);
  const resolverRef = useRef<((approval: AssignmentApproval | null) => void) | null>(null);

  const requestApproval = useCallback(
    (nextEvaluation: AssignmentEvaluation) =>
      new Promise<AssignmentApproval | null>((resolve) => {
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setEvaluation(nextEvaluation);
      }),
    [],
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
    [],
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
