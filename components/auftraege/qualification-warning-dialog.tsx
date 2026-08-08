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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  getCoverageStatusLabel,
  type AssignmentApproval,
  type AssignmentEvaluation,
} from '@/lib/qualifications/types';

type QualificationWarningDialogProps = {
  evaluation: AssignmentEvaluation | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (approval: AssignmentApproval) => void | Promise<void>;
};

export function QualificationWarningDialog({
  evaluation,
  isSubmitting = false,
  onCancel,
  onConfirm,
}: QualificationWarningDialogProps) {
  if (!evaluation) return null;

  return (
    <QualificationWarningDialogContent
      key={evaluation.fingerprint}
      evaluation={evaluation}
      isSubmitting={isSubmitting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function QualificationWarningDialogContent({
  evaluation,
  isSubmitting,
  onCancel,
  onConfirm,
}: Omit<QualificationWarningDialogProps, 'evaluation'> & {
  evaluation: AssignmentEvaluation;
}) {
  const [reason, setReason] = useState('');
  const [showReasonError, setShowReasonError] = useState(false);

  const handleConfirm = async () => {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || !evaluation) {
      setShowReasonError(true);
      return;
    }
    await onConfirm({
      fingerprint: evaluation.fingerprint,
      reason: normalizedReason,
    });
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

          <div className="space-y-1.5">
            <Label htmlFor="qualification-override-reason">
              Kurze Begründung
            </Label>
            <Textarea
              id="qualification-override-reason"
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
              aria-invalid={showReasonError}
              aria-describedby={
                showReasonError
                  ? 'qualification-override-reason-error'
                  : undefined
              }
            />
            {showReasonError && (
              <p
                id="qualification-override-reason-error"
                role="alert"
                className="text-xs text-destructive"
              >
                Bitte gib eine kurze Begründung ein.
              </p>
            )}
          </div>
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
