'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { useBusyIds } from '@/hooks/use-busy-id';
import { useClientRead } from '@/hooks/use-client-read';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import type { StoredDraft } from '@/lib/field-sync/device/draft-store';
import { readInBackground } from '@/lib/data/background-read-client';
import { requiredWorkArtifactFields, workArtifactFieldIssues } from '@/lib/work-artifacts/field-rules';
import type {
  RecordedVisitWindow,
  WorkArtifactDetail,
  WorkArtifactKind,
  WorkArtifactSummary,
  WorkArtifactVisibility,
} from '@/lib/work-artifacts/types';
import {
  contentForEditor,
  contentForKind,
  contentFromDetail,
  EMPTY_CONTENT,
  localDateTime,
  type WorkArtifactContentDraft,
} from './work-artifact-content';
import { WORK_ARTIFACT_CONTROL_IDS, workArtifactFieldErrors } from './work-artifact-field-errors';

type WorkArtifactEditorOptions = {
  artifactId: string | null;
  initialSummary: WorkArtifactSummary | null;
  defaultSiteId: string | undefined;
  /** A new work report's Beginn and Ende from today's recorded time on the job. */
  recordedVisit: RecordedVisitWindow;
  readOnly: boolean;
  /** The draft of a new Arbeitsnachweis this device kept: the form opens with it. */
  restored?: StoredDraft | null;
};

/** One rule field's control id, required mark and current error. */
export type WorkArtifactFieldState = (field: keyof typeof WORK_ARTIFACT_CONTROL_IDS) => {
  id: string;
  required: boolean;
  error: string | undefined;
};

/** The loaded artifact, its editable draft and the reload every dialog action builds on. */
export function useWorkArtifactEditor({
  artifactId,
  initialSummary,
  defaultSiteId,
  recordedVisit,
  readOnly,
  restored = null,
}: WorkArtifactEditorOptions) {
  const [detail, setDetail] = useState<WorkArtifactDetail | null>(null);
  const [editing, setEditing] = useState(!artifactId && !readOnly);
  // The form opens with the draft the device kept, else with the saved revision or the defaults.
  const first = restored ?? initialSummary?.currentRevision;
  const [kind, setKind] = useState<WorkArtifactKind>(first?.kind ?? 'work_report');
  const [visibility, setVisibility] = useState<WorkArtifactVisibility>(first?.visibility ?? 'internal_only');
  const [title, setTitle] = useState(first?.title ?? '');
  const [capturedAt, setCapturedAt] = useState(() =>
    initialCapturedAt(restored?.capturedAt ?? initialSummary?.currentRevision.captured_at),
  );
  const [content, setContent] = useState(() =>
    restored ? contentForEditor(restored.content) : initialContent(artifactId, defaultSiteId, recordedVisit),
  );
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionReasonError, setCorrectionReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readTarget, setReadTarget] = useWorkArtifactReadTarget(artifactId);
  // Keyed by the button that was clicked (or `evidence:<requirementId>` per
  // evidence row) so only that control spins; `anyBusy` still gates the rest
  // of the dialog because most flows reload the shared detail afterwards.
  const { run: runArtifactTask, isBusy, anyBusy } = useBusyIds();

  // The initial read and every reload fill the draft the same way.
  const applyDetail = useCallback((artifact: WorkArtifactDetail) => {
    setDetail(artifact);
    setKind(artifact.kind);
    const revision = artifact.revisions.find((entry) => entry.id === artifact.current_revision_id);
    if (!revision) return;
    setVisibility(revision.visibility);
    setTitle(revision.title);
    setCapturedAt(localDateTime(revision.captured_at));
    setContent(contentFromDetail(artifact));
  }, []);

  const { artifactRead, loading, load } = useWorkArtifactRead({ readTarget, setReadTarget, applyDetail });

  const currentRevision = detail?.revisions.find((entry) => entry.id === detail.current_revision_id) ?? null;
  const requiresCorrectionReason = Boolean(
    detail && (detail.status !== 'draft' || detail.actions.length > 0),
  );
  const measurementLines = content.measurementLines ?? [];

  function patchContent(patch: Partial<WorkArtifactContentDraft>) {
    setContent((current) => ({ ...current, ...patch }));
  }

  const handleMutationFailure = mutationFailureHandler({ detail, load, setError });
  const fieldMarks = useWorkArtifactFieldMarks(kind, title, content);

  return {
    detail,
    loading,
    loadFailure: artifactRead.failure,
    editing,
    setEditing,
    kind,
    setKind,
    visibility,
    setVisibility,
    title,
    setTitle,
    capturedAt,
    setCapturedAt,
    content,
    correctionReason,
    setCorrectionReason,
    correctionReasonError,
    setCorrectionReasonError,
    ...fieldMarks,
    error,
    setError,
    runArtifactTask,
    isBusy,
    anyBusy,
    load,
    applyDetail,
    currentRevision,
    requiresCorrectionReason,
    measurementLines,
    patchContent,
    handleMutationFailure,
  };
}

/** „Erfasst am“ of the opened draft or revision as a local time; now for a new Arbeitsnachweis. */
function initialCapturedAt(storedAt: string | undefined): string {
  return localDateTime(storedAt) || localDateTime(new Date().toISOString());
}

/** A new draft's content: the job's site and, for a new report, today's recorded visit window. */
function initialContent(
  artifactId: string | null,
  defaultSiteId: string | undefined,
  recordedVisit: RecordedVisitWindow,
): WorkArtifactContentDraft {
  return {
    ...EMPTY_CONTENT,
    siteId: defaultSiteId,
    visitStartedAt: artifactId ? undefined : localDateTime(recordedVisit.startedAt),
    visitEndedAt: artifactId ? undefined : localDateTime(recordedVisit.endedAt),
  };
}

/** The last save attempt and, from then on, the draft's broken rules at their fields as the user edits. */
function useWorkArtifactFieldMarks(kind: WorkArtifactKind, title: string, content: WorkArtifactContentDraft) {
  const [attemptedSave, setAttemptedSave] = useState<{ submit: boolean } | null>(null);
  const fieldErrors = attemptedSave
    ? workArtifactFieldErrors(
        workArtifactFieldIssues({
          kind,
          title,
          submit: attemptedSave.submit,
          content: contentForKind(kind, content),
        }),
      )
    : {};
  const requiredFields = requiredWorkArtifactFields(kind);
  const fieldState: WorkArtifactFieldState = (field) => {
    const id = WORK_ARTIFACT_CONTROL_IDS[field];
    return { id, required: requiredFields.has(field), error: fieldErrors[id] };
  };
  return { setAttemptedSave, fieldErrors, fieldState };
}

type WorkArtifactReadTarget = { id: string | null; revision: number };

/** The artifact to read; a newly opened artifact becomes the target during render. */
function useWorkArtifactReadTarget(artifactId: string | null) {
  // The artifact to read: the opened one, or the one a save created. Every
  // `load` reads again; the last detail stays visible while it runs.
  const [readTarget, setReadTarget] = useState<WorkArtifactReadTarget>({ id: artifactId, revision: 0 });
  // A newly opened artifact is read at once, unless a save already reads it.
  const [openedArtifactId, setOpenedArtifactId] = useState(artifactId);
  if (artifactId !== openedArtifactId) {
    setOpenedArtifactId(artifactId);
    if (artifactId !== null && artifactId !== readTarget.id)
      setReadTarget((current) => ({ id: artifactId, revision: current.revision }));
  }
  return [readTarget, setReadTarget] as const;
}

type WorkArtifactReadOptions = {
  readTarget: WorkArtifactReadTarget;
  setReadTarget: Dispatch<SetStateAction<WorkArtifactReadTarget>>;
  applyDetail: (artifact: WorkArtifactDetail) => void;
};

/** The artifact read, the adoption of each answer into the draft, and the reload a mutation awaits. */
function useWorkArtifactRead({ readTarget, setReadTarget, applyDetail }: WorkArtifactReadOptions) {
  const targetId = readTarget.id;
  const artifactRead = useClientRead({
    read: (signal) => readInBackground('work-artifact-detail', { artifactId: targetId ?? '' }, signal),
    deps: [targetId, readTarget.revision],
    enabled: targetId !== null,
    failureMessage: 'Der Arbeitsnachweis konnte nicht geladen werden.',
  });
  // Each answer fills the draft once, during render.
  const [adoptedRead, setAdoptedRead] = useState(artifactRead.data);
  if (artifactRead.data !== adoptedRead) {
    setAdoptedRead(artifactRead.data);
    if (artifactRead.data) applyDetail(artifactRead.data.artifact);
  }
  const loading = artifactRead.loading;
  // A mutation awaits its reload inside its busy task, so no action of the
  // dialog runs against the version the mutation just replaced.
  // Each waiter names the read it waits for; an effect of an earlier render
  // (an earlier revision) cannot settle it. A failed read settles it too: the
  // editor then shows the failure with its retry.
  const lastRevision = useRef(0);
  const readWaiters = useRef<Array<{ revision: number; resolve: () => void }>>([]);
  const settledRevision = loading ? null : readTarget.revision;
  useEffect(() => {
    if (settledRevision === null) return;
    readWaiters.current = readWaiters.current.filter((waiter) => {
      if (waiter.revision > settledRevision) return true;
      waiter.resolve();
      return false;
    });
  }, [settledRevision]);

  /** Reads the artifact again; the editor shows the reload, adopts its answer and then settles the promise. */
  function load(id: string): Promise<void> {
    lastRevision.current += 1;
    const revision = lastRevision.current;
    return new Promise((resolve) => {
      readWaiters.current.push({ revision, resolve });
      setReadTarget({ id, revision });
    });
  }

  return { artifactRead, loading, load };
}

type MutationFailureContext = {
  detail: WorkArtifactDetail | null;
  load: (id: string) => Promise<void>;
  setError: (message: string | null) => void;
};

/** Shows a failed mutation's sentence and returns whether it failed; a stale write reloads unless the draft must stay. */
function mutationFailureHandler({ detail, load, setError }: MutationFailureContext) {
  return async function handleMutationFailure(
    result: ActionResult,
    message: string,
    reloadOnConflict = true,
  ): Promise<boolean> {
    if (result.success) return false;
    if (result.error.includes('stale')) {
      if (reloadOnConflict && detail) await load(detail.id);
      setError(
        reloadOnConflict
          ? 'Der Arbeitsnachweis wurde zwischenzeitlich geändert. Der aktuelle Stand wurde geladen.'
          : 'Der Arbeitsnachweis wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.',
      );
      return true;
    }
    // A shared code (a failed read, a missing permission) names its cause; the rest keep the action's sentence.
    setError(describeFailure(result.error, {}, message));
    return true;
  };
}

export type WorkArtifactEditor = ReturnType<typeof useWorkArtifactEditor>;
