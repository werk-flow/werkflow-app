'use client';

import { useState } from 'react';

import { useClientRead } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { Button } from '@/components/ui/button';
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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { readInBackground } from '@/lib/data/background-read-client';
import { linkWorkDependencyArtifactApproval } from '@/lib/work-lifecycle/actions';
import type { WorkDependency, WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import { APPROVALS_LOAD_FAILED_MESSAGE, workLifecycleErrorMessage } from './work-lifecycle-messages';

type ArtifactApprovalDependencyDialogProps = {
  snapshot: WorkLifecycleSnapshot;
  dependency: WorkDependency;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

/** State, approval read, validation and save of the approval link dialog. */
function useArtifactApprovalDependencyForm({
  snapshot,
  dependency,
  onClose,
  onChanged,
}: ArtifactApprovalDependencyDialogProps) {
  const [actionId, setActionId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run: runApprovalTask, isPending: pending } = usePendingTask();
  // A failed load leaves no options: an empty list would read as „no approval exists“.
  const approvals = useClientRead({
    read: (signal) =>
      readInBackground(
        'approved-artifact-actions',
        { targetType: snapshot.targetType, targetId: snapshot.targetId },
        signal,
      ),
    deps: [snapshot.targetType, snapshot.targetId],
    failureMessage: APPROVALS_LOAD_FAILED_MESSAGE,
  });
  const options = approvals.data?.options;
  const [attempted, setAttempted] = useState(false);
  const fieldErrors = {
    'dependency-artifact-approval': actionId ? undefined : 'Bitte wähle eine Freigabe.',
    'dependency-artifact-reason': reason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined,
  };
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(fieldErrors)) return;
    void runApprovalTask(async () => {
      const result = await linkWorkDependencyArtifactApproval({
        dependencyId: dependency.id,
        expectedVersion: dependency.version,
        actionId,
        reason: reason.trim(),
      });
      if (!result.success) {
        setError(workLifecycleErrorMessage(result.error));
        return;
      }
      await onChanged();
      onClose();
    });
  }
  return {
    actionId,
    setActionId,
    reason,
    setReason,
    error,
    pending,
    approvals,
    options,
    attempted,
    fieldErrors,
    submit,
  };
}

export function ArtifactApprovalDependencyDialog({
  snapshot,
  dependency,
  onClose,
  onChanged,
}: ArtifactApprovalDependencyDialogProps) {
  const form = useArtifactApprovalDependencyForm({ snapshot, dependency, onClose, onChanged });
  const { actionId, setActionId, reason, setReason, error, pending, approvals, options } = form;
  const { attempted, fieldErrors, submit } = form;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={pending}>
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Freigabe verknüpfen</DialogTitle>
            <DialogDescription>
              Nur eine aktuelle, intern freigegebene Version dieses Auftrags oder Projekts erfüllt die
              Voraussetzung.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field
              label="Freigegebener Arbeitsnachweis"
              htmlFor="dependency-artifact-approval"
              required
              error={attempted ? fieldErrors['dependency-artifact-approval'] : undefined}
            >
              {approvals.failure ? (
                <SectionError failure={approvals.failure} />
              ) : options === undefined ? (
                // A skeleton stands in for the select, so the dialog takes first focus until it arrives.
                <div role="status" aria-busy="true">
                  <span className="sr-only">Freigaben werden geladen.</span>
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : (
                <SearchableSelect
                  options={options}
                  value={actionId}
                  onChange={setActionId}
                  placeholder="Freigabe auswählen"
                  searchPlaceholder="Arbeitsnachweis suchen…"
                  emptyMessage="Keine aktuelle Freigabe vorhanden"
                />
              )}
            </Field>
            <Field
              label="Begründung"
              htmlFor="dependency-artifact-reason"
              required
              error={attempted ? fieldErrors['dependency-artifact-reason'] : undefined}
            >
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button pending={pending} type="submit" disabled={pending}>
              Verknüpfen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
