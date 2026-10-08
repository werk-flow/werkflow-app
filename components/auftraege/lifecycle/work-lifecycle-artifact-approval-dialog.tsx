'use client';

import { useEffect, useState } from 'react';

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
import { Textarea } from '@/components/ui/textarea';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import {
  getApprovedArtifactActionsForTarget,
  linkWorkDependencyArtifactApproval,
} from '@/lib/work-lifecycle/actions';
import type { WorkDependency, WorkEntityOption, WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import { OptionsLoadError } from '../shared/options-load-error';
import { APPROVALS_LOAD_FAILED_MESSAGE, workLifecycleErrorMessage } from './work-lifecycle-messages';

type ArtifactApprovalDependencyDialogProps = {
  snapshot: WorkLifecycleSnapshot;
  dependency: WorkDependency;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export function ArtifactApprovalDependencyDialog({
  snapshot,
  dependency,
  onClose,
  onChanged,
}: ArtifactApprovalDependencyDialogProps) {
  const [options, setOptions] = useState<WorkEntityOption[] | null>(null);
  const [actionId, setActionId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A failed load keeps `options` null: an empty list would read as „no approval exists“.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { run: runApprovalTask, isPending: pending } = usePendingTask();
  useEffect(() => {
    let active = true;
    void getApprovedArtifactActionsForTarget({ targetType: snapshot.targetType, targetId: snapshot.targetId })
      .then((result) => {
        if (!active) return;
        if (result.success) setOptions(result.options);
        else setLoadError(APPROVALS_LOAD_FAILED_MESSAGE);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(APPROVALS_LOAD_FAILED_MESSAGE);
      });
    return () => {
      active = false;
    };
  }, [snapshot.targetId, snapshot.targetType, loadAttempt]);
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
              {loadError ? (
                <OptionsLoadError
                  error={loadError}
                  onRetry={() => {
                    setLoadError(null);
                    setLoadAttempt((attempt) => attempt + 1);
                  }}
                  retrying={false}
                />
              ) : options === null ? (
                <p className="text-sm text-muted-foreground">Freigaben werden geladen…</p>
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
