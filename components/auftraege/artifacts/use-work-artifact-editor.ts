'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useBusyIds } from '@/hooks/use-busy-id';
import { useClientRead } from '@/hooks/use-client-read';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import { getWorkArtifactDetail } from '@/lib/work-artifacts/actions';
import type {
  WorkArtifactDetail,
  WorkArtifactKind,
  WorkArtifactSummary,
  WorkArtifactVisibility,
} from '@/lib/work-artifacts/types';
import {
  contentFromDetail,
  EMPTY_CONTENT,
  localDateTime,
  type WorkArtifactContentDraft,
} from './work-artifact-content';

type WorkArtifactEditorOptions = {
  artifactId: string | null;
  initialSummary: WorkArtifactSummary | null;
  defaultSiteId: string | undefined;
  readOnly: boolean;
};

/** The loaded artifact, its editable draft and the reload every dialog action builds on. */
export function useWorkArtifactEditor({
  artifactId,
  initialSummary,
  defaultSiteId,
  readOnly,
}: WorkArtifactEditorOptions) {
  const [detail, setDetail] = useState<WorkArtifactDetail | null>(null);
  const [editing, setEditing] = useState(!artifactId && !readOnly);
  const [kind, setKind] = useState<WorkArtifactKind>(initialSummary?.kind ?? 'work_report');
  const [visibility, setVisibility] = useState<WorkArtifactVisibility>(
    initialSummary?.currentRevision.visibility ?? 'internal_only',
  );
  const [title, setTitle] = useState(initialSummary?.currentRevision.title ?? '');
  const [capturedAt, setCapturedAt] = useState(
    localDateTime(initialSummary?.currentRevision.captured_at) || localDateTime(new Date().toISOString()),
  );
  const [content, setContent] = useState<WorkArtifactContentDraft>({
    ...EMPTY_CONTENT,
    siteId: defaultSiteId,
  });
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionReasonError, setCorrectionReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The artifact to read: the opened one, or the one a save created. Every
  // `load` reads again; the last detail stays visible while it runs.
  const [readTarget, setReadTarget] = useState({ id: artifactId, revision: 0 });
  // A newly opened artifact is read at once, unless a save already reads it.
  const [openedArtifactId, setOpenedArtifactId] = useState(artifactId);
  if (artifactId !== openedArtifactId) {
    setOpenedArtifactId(artifactId);
    if (artifactId !== null && artifactId !== readTarget.id)
      setReadTarget((current) => ({ id: artifactId, revision: current.revision }));
  }
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

  const targetId = readTarget.id;
  const artifactRead = useClientRead({
    read: () => getWorkArtifactDetail(targetId ?? ''),
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

  const currentRevision = detail?.revisions.find((entry) => entry.id === detail.current_revision_id) ?? null;
  const requiresCorrectionReason = Boolean(
    detail && (detail.status !== 'draft' || detail.actions.length > 0),
  );
  const measurementLines = content.measurementLines ?? [];

  function patchContent(patch: Partial<WorkArtifactContentDraft>) {
    setContent((current) => ({ ...current, ...patch }));
  }

  async function handleMutationFailure(
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
  }

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

export type WorkArtifactEditor = ReturnType<typeof useWorkArtifactEditor>;
