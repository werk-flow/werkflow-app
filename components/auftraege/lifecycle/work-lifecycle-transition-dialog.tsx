'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
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
import { Textarea } from '@/components/ui/textarea';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import {
  workTransitionActionLabel,
  type WorkExecutionState,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import type { WorkTransitionInput } from './work-lifecycle-dialog-state';

type WorkTransitionDialogProps = {
  snapshot: WorkLifecycleSnapshot;
  targetLabel: string;
  transition: WorkExecutionState;
  isManager: boolean;
  onClose: () => void;
  /** Shows the new state at once, writes it, and resolves with the refusal sentence or null. */
  onTransition: (input: WorkTransitionInput) => Promise<string | null>;
};

export function WorkTransitionDialog({
  snapshot,
  targetLabel,
  transition,
  isManager,
  onClose,
  onTransition,
}: WorkTransitionDialogProps) {
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showBanner } = useBanner();
  const { run: runTransitionTask, isPending: pending } = usePendingTask();
  // Only the manager exception is correctable in this dialog. Every other
  // refusal names a rule outside it, so the dialog closes with the click.
  const canCorrectRefusal =
    isManager && (transition === 'execution_complete' || transition === 'handed_over');
  const needsReason =
    override ||
    snapshot.targetType === 'project' ||
    transition === 'cancelled' ||
    transition === 'interrupted' ||
    transition === 'handed_over' ||
    ['execution_complete', 'handed_over', 'cancelled'].includes(snapshot.executionState);
  const [attempted, setAttempted] = useState(false);
  const reasonError = needsReason && reason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setAttempted(true);
    if (focusFirstInvalidField({ 'work-transition-reason': reasonError })) return;
    const input: WorkTransitionInput = {
      toState: transition,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      overrideGates: override,
    };
    if (!canCorrectRefusal) {
      onClose();
      void onTransition(input).then((refusal) => {
        if (refusal) showBanner({ variant: 'error', message: refusal });
      });
      return;
    }
    void runTransitionTask(async () => {
      const refusal = await onTransition(input);
      if (refusal) setError(refusal);
      else onClose();
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={pending}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{workTransitionActionLabel(snapshot.executionState, transition)}</DialogTitle>
            <DialogDescription>{`Arbeitsstand für „${targetLabel}“ ändern. Die Änderung wird mit Prüfstand und Version protokolliert.`}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            {needsReason && (
              <Field
                label="Grund"
                htmlFor="work-transition-reason"
                required
                error={attempted ? reasonError : undefined}
              >
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  placeholder="Warum ist dieser Schritt jetzt richtig?"
                  required
                />
              </Field>
            )}
            {isManager && (transition === 'execution_complete' || transition === 'handed_over') && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={override} onCheckedChange={(checked) => setOverride(checked === true)} />
                <span>
                  Manager-Ausnahme verwenden, falls eine prüfbare Abschlussbedingung fehlt. Der Grund und der
                  Prüfstand werden protokolliert.
                </span>
              </label>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button pending={pending} type="submit" disabled={pending}>
              Änderung speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
