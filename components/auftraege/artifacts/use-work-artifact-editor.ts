'use client';

import { useCallback, useEffect, useState } from 'react';

import { useBusyIds } from '@/hooks/use-busy-id';
import { describeFailure } from '@/lib/action-messages';
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
  const [loading, setLoading] = useState(Boolean(artifactId));
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
  // The last read of the artifact failed; the dialog offers a retry in place.
  const [loadFailed, setLoadFailed] = useState(false);
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

  async function load(id: string) {
    setLoading(true);
    setLoadFailed(false);
    const result = await getWorkArtifactDetail(id).catch(() => null);
    setLoading(false);
    if (!result?.success) {
      setLoadFailed(true);
      return;
    }
    applyDetail(result.artifact);
  }
  useEffect(() => {
    if (!artifactId) return;
    let active = true;
    void getWorkArtifactDetail(artifactId)
      .then((result) => {
        if (!active) return;
        setLoading(false);
        if (!result.success) {
          setLoadFailed(true);
          return;
        }
        applyDetail(result.artifact);
      })
      .catch(() => {
        // A thrown read (network, aborted action) must not leave the skeleton up forever.
        if (!active) return;
        setLoading(false);
        setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [artifactId, applyDetail]);

  const currentRevision = detail?.revisions.find((entry) => entry.id === detail.current_revision_id) ?? null;
  const requiresCorrectionReason = Boolean(
    detail && (detail.status !== 'draft' || detail.actions.length > 0),
  );
  const measurementLines = content.measurementLines ?? [];

  function patchContent(patch: Partial<WorkArtifactContentDraft>) {
    setContent((current) => ({ ...current, ...patch }));
  }

  async function handleMutationFailure(
    result: { success: boolean; error?: string },
    message: string,
    reloadOnConflict = true,
  ): Promise<boolean> {
    if (result.success) return false;
    if (result.error?.includes('stale')) {
      if (reloadOnConflict && detail) await load(detail.id);
      setError(
        reloadOnConflict
          ? 'Der Arbeitsnachweis wurde zwischenzeitlich geändert. Der aktuelle Stand wurde geladen.'
          : 'Der Arbeitsnachweis wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.',
      );
      return true;
    }
    // A shared code (a failed read, a missing permission) names its cause; the rest keep the action's sentence.
    setError(describeFailure(result.error ?? '', {}, message));
    return true;
  }

  return {
    detail,
    loading,
    loadFailed,
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
