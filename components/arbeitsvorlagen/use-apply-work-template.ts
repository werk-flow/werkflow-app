'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
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

const VERSION_REQUIRED = 'Bitte wähle zuerst eine Arbeitsvorlage.';

type ApplyWorkTemplateInput = {
  targetType: WorkTemplateTargetType;
  targetId: string;
  onApplied?: (() => void) | undefined;
};

type ApplyWorkTemplateState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Null until the published templates are read. */
  options: PublishedWorkTemplateOption[] | null;
  optionsFailure: ReadFailure | null;
  versionId: string;
  preview: WorkTemplateApplicationPreview | null;
  previewFailure: ReadFailure | null;
  allowAdditional: boolean;
  setAllowAdditional: (allowAdditional: boolean) => void;
  versionError: string | undefined;
  error: string | null;
  qualificationWarning: AssignmentEvaluation | null;
  setQualificationWarning: (evaluation: AssignmentEvaluation | null) => void;
  isPending: boolean;
  previewPending: boolean;
  selectVersion: (versionId: string) => void;
  submit: (approval?: AssignmentApproval) => void;
  openDialog: () => void;
};

type ApplyFailure = Exclude<Awaited<ReturnType<typeof applyWorkTemplate>>, { success: true }>;

/** What a refused or unreachable application shows: the qualification warning, or a sentence. */
function applyFailureFeedback(
  result: ApplyFailure | null,
): { kind: 'warning'; evaluation: AssignmentEvaluation } | { kind: 'error'; message: string } {
  if (!result) return { kind: 'error', message: 'Die Arbeitsvorlage konnte nicht angewendet werden.' };
  if (
    (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
    'evaluation' in result &&
    result.evaluation
  ) {
    return { kind: 'warning', evaluation: result.evaluation };
  }
  if (
    result.error === 'work_template_reference_unavailable' &&
    'referenceName' in result &&
    result.referenceName
  ) {
    return {
      kind: 'error',
      message: `„${result.referenceName}“ ist nicht mehr aktiv. Korrigiere die Vorlage und versuche es erneut.`,
    };
  }
  return {
    kind: 'error',
    message: describeFailure(
      result.error,
      APPLY_ERROR_MESSAGES,
      'Die Arbeitsvorlage konnte nicht angewendet werden.',
    ),
  };
}

/** The application of one version onto the target; the same version on the same target repeats its key. */
function applyRequest({
  targetType,
  targetId,
  versionId,
  allowAdditional,
  approval,
}: {
  targetType: WorkTemplateTargetType;
  targetId: string;
  versionId: string;
  allowAdditional: boolean;
  approval: AssignmentApproval | undefined;
}): Parameters<typeof applyWorkTemplate>[0] {
  return {
    templateVersionId: versionId,
    ...(targetType === 'job' ? { jobId: targetId } : { projectId: targetId }),
    allowAdditional,
    idempotencyKey: `apply-${targetType}-${targetId}-${versionId}`,
    assignmentApproval: approval ?? null,
  };
}

/** The published templates while the dialog is open, and the preview of the chosen version. */
function useApplyTemplateReads({
  targetType,
  targetId,
  open,
  versionId,
}: {
  targetType: WorkTemplateTargetType;
  targetId: string;
  open: boolean;
  versionId: string;
}) {
  // Each opening reads the published templates fresh; a closed dialog drops them.
  const templates = useClientRead({
    read: (signal) => readInBackground('published-work-templates', { targetType }, signal),
    deps: [targetType],
    enabled: open,
    failureMessage: 'Arbeitsvorlagen konnten nicht geladen werden.',
  });
  const previewRead = useClientRead({
    read: (signal) =>
      readInBackground(
        'work-template-preview',
        { versionId, targetType, ...(targetType === 'job' ? { jobId: targetId } : { projectId: targetId }) },
        signal,
      ),
    deps: [targetId, targetType, versionId],
    enabled: versionId !== '',
    failureMessage: 'Die Vorschau konnte nicht geladen werden.',
  });
  return { templates, previewRead };
}

/** Option loading, preview and application of a published work template onto one job or project. */
export function useApplyWorkTemplate({
  targetType,
  targetId,
  onApplied,
}: ApplyWorkTemplateInput): ApplyWorkTemplateState {
  const [open, setOpen] = useState(false);
  const [versionId, setVersionId] = useState('');
  const [allowAdditional, setAllowAdditional] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const { run: runPendingTask, isPending } = usePendingTask();
  const { showBanner } = useBanner();
  const { templates, previewRead } = useApplyTemplateReads({ targetType, targetId, open, versionId });
  const options = templates.data?.data ?? null;
  const preview = previewRead.data?.data ?? null;
  // Selecting a version clears preview and error; the window until either lands must not look idle.
  const previewPending =
    Boolean(versionId) && preview === null && error === null && previewRead.failure === null;

  function submit(approval?: AssignmentApproval) {
    setAttempted(true);
    if (focusFirstInvalidField({ 'apply-work-template-version': versionId ? undefined : VERSION_REQUIRED }))
      return;
    if (!preview || preview.hasSameVersionApplication) return;
    if (preview.hasExistingApplication && !allowAdditional) {
      setError('Bestätige zuerst, dass du eine weitere Vorlage ergänzen möchtest.');
      return;
    }
    setError(null);
    // Close the warning first so a failure message is not hidden behind it.
    setQualificationWarning(null);
    void runPendingTask(async () => {
      const result = await applyWorkTemplate(
        applyRequest({ targetType, targetId, versionId, allowAdditional, approval }),
      ).catch(() => null);
      if (!result?.success) {
        const feedback = applyFailureFeedback(result);
        if (feedback.kind === 'warning') setQualificationWarning(feedback.evaluation);
        else setError(feedback.message);
        return;
      }
      setOpen(false);
      setVersionId('');
      // applyWorkTemplate's response renders the route with the new planning.
      onApplied?.();
      showBanner({
        variant: 'success',
        message: 'Arbeitsvorlage wurde als bearbeitbare Planung übernommen.',
      });
    });
  }

  function openDialog(): void {
    selectVersion('');
    setOpen(true);
  }

  function selectVersion(value: string): void {
    setVersionId(value);
    // A new preview asks again whether to add a further template, and a new
    // choice starts without the previous attempt's field error.
    setAllowAdditional(false);
    setError(null);
    setAttempted(false);
  }

  return {
    open,
    setOpen,
    options,
    optionsFailure: templates.failure,
    versionId,
    preview,
    previewFailure: previewRead.failure,
    allowAdditional,
    setAllowAdditional,
    versionError: attempted && !versionId ? VERSION_REQUIRED : undefined,
    error,
    qualificationWarning,
    setQualificationWarning,
    isPending,
    previewPending,
    selectVersion,
    submit,
    openDialog,
  };
}
