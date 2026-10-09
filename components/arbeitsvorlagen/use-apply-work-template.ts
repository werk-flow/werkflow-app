'use client';

import { useEffect, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import { applyWorkTemplate } from '@/lib/work-templates/actions';
import type {
  PublishedWorkTemplateOption,
  WorkTemplateApplicationPreview,
  WorkTemplateTargetType,
} from '@/lib/work-templates/types';

const APPLY_ERROR_MESSAGES = {
  work_template_already_applied: 'Diese Version wurde bereits angewendet.',
  work_template_additional_confirmation_required:
    'Bestätige zuerst, dass du eine weitere Vorlage ergänzen möchtest.',
  work_template_target_not_incomplete:
    'Vorlagen lassen sich nur auf noch nicht abgeschlossene Arbeit anwenden.',
  work_template_reference_unavailable: 'Die Vorlage verweist auf nicht mehr aktive Stammdaten.',
  work_template_version_unavailable: 'Die Vorlage ist nicht mehr verfügbar.',
} satisfies Record<string, string>;

type ApplyWorkTemplateInput = {
  targetType: WorkTemplateTargetType;
  targetId: string;
  onApplied?: (() => void) | undefined;
};

/** A failed read of the dialog: which region failed decides what the retry clears. */
type ApplyWorkTemplateLoadError = { region: 'options' | 'preview'; message: string };

type ApplyWorkTemplateState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  options: PublishedWorkTemplateOption[] | null;
  versionId: string;
  preview: WorkTemplateApplicationPreview | null;
  allowAdditional: boolean;
  setAllowAdditional: (allowAdditional: boolean) => void;
  error: string | null;
  loadError: string | null;
  retryLoad: () => void;
  qualificationWarning: AssignmentEvaluation | null;
  setQualificationWarning: (evaluation: AssignmentEvaluation | null) => void;
  isPending: boolean;
  previewPending: boolean;
  selectVersion: (versionId: string) => void;
  submit: (approval?: AssignmentApproval) => void;
  openDialog: () => void;
};

/** Option loading, preview and application of a published work template onto one job or project. */
export function useApplyWorkTemplate({
  targetType,
  targetId,
  onApplied,
}: ApplyWorkTemplateInput): ApplyWorkTemplateState {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PublishedWorkTemplateOption[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [preview, setPreview] = useState<WorkTemplateApplicationPreview | null>(null);
  const [allowAdditional, setAllowAdditional] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<ApplyWorkTemplateLoadError | null>(null);
  // Incremented by the retry so the failed read runs again with the same selection.
  const [reloadCount, setReloadCount] = useState(0);
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const { run: runPendingTask, isPending } = usePendingTask();
  const { showBanner } = useBanner();
  // Selecting a version clears preview and error; the window until either lands must not look idle.
  const previewPending = Boolean(versionId) && preview === null && error === null && loadError === null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void readInBackground('published-work-templates', { targetType }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.success) {
        setOptions([]);
        setLoadError({ region: 'options', message: 'Arbeitsvorlagen konnten nicht geladen werden.' });
        return;
      }
      setOptions(result.data);
    });
    return () => controller.abort();
  }, [open, targetType, reloadCount]);

  useEffect(() => {
    if (!versionId) return;
    const controller = new AbortController();
    void readInBackground(
      'work-template-preview',
      { versionId, targetType, ...(targetType === 'job' ? { jobId: targetId } : { projectId: targetId }) },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.success) {
        setPreview(null);
        setLoadError({ region: 'preview', message: 'Die Vorschau konnte nicht geladen werden.' });
        return;
      }
      setPreview(result.data);
      setAllowAdditional(false);
      setError(null);
    });
    return () => controller.abort();
  }, [targetId, targetType, versionId, reloadCount]);

  function retryLoad(): void {
    if (loadError?.region === 'options') setOptions(null);
    setLoadError(null);
    setReloadCount((count) => count + 1);
  }

  function submit(approval?: AssignmentApproval) {
    if (!versionId) {
      setError('Bitte wähle zuerst eine Arbeitsvorlage.');
      document.getElementById('apply-work-template-version')?.focus();
      return;
    }
    if (!preview || preview.hasSameVersionApplication) return;
    if (preview.hasExistingApplication && !allowAdditional) {
      setError('Bestätige zuerst, dass du eine weitere Vorlage ergänzen möchtest.');
      return;
    }
    setError(null);
    // Close the warning first so a failure message is not hidden behind it.
    setQualificationWarning(null);
    void runPendingTask(async () => {
      const result = await applyWorkTemplate({
        templateVersionId: versionId,
        ...(targetType === 'job' ? { jobId: targetId } : { projectId: targetId }),
        allowAdditional,
        idempotencyKey: `apply-${targetType}-${targetId}-${versionId}`,
        assignmentApproval: approval ?? null,
      }).catch(() => null);
      if (!result?.success) {
        if (!result) {
          setError('Die Arbeitsvorlage konnte nicht angewendet werden.');
          return;
        }
        if (
          (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
          'evaluation' in result &&
          result.evaluation
        ) {
          setQualificationWarning(result.evaluation);
          return;
        }
        if (
          result.error === 'work_template_reference_unavailable' &&
          'referenceName' in result &&
          result.referenceName
        ) {
          setError(
            `„${result.referenceName}“ ist nicht mehr aktiv. Korrigiere die Vorlage und versuche es erneut.`,
          );
          return;
        }
        setError(
          describeFailure(
            result.error,
            APPLY_ERROR_MESSAGES,
            'Die Arbeitsvorlage konnte nicht angewendet werden.',
          ),
        );
        return;
      }
      setOpen(false);
      setVersionId('');
      setPreview(null);
      // applyWorkTemplate's response renders the route with the new planning.
      onApplied?.();
      showBanner({
        variant: 'success',
        message: 'Arbeitsvorlage wurde als bearbeitbare Planung übernommen.',
      });
    });
  }

  function openDialog(): void {
    setOptions(null);
    setVersionId('');
    setPreview(null);
    setAllowAdditional(false);
    setError(null);
    setLoadError(null);
    setOpen(true);
  }

  function selectVersion(value: string): void {
    setVersionId(value);
    setPreview(null);
    setError(null);
    setLoadError(null);
  }

  return {
    open,
    setOpen,
    options,
    versionId,
    preview,
    allowAdditional,
    setAllowAdditional,
    error,
    loadError: loadError?.message ?? null,
    retryLoad,
    qualificationWarning,
    setQualificationWarning,
    isPending,
    previewPending,
    selectVersion,
    submit,
    openDialog,
  };
}
