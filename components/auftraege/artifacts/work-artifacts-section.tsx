'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionError } from '@/components/ui/section-error';
import { PlainButton } from '@/components/ui/plain-button';
import { useState, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { lazyDialog } from '@/components/shared/lazy-dialog';
import { useLiveView } from '@/hooks/use-live-view';
import type { OrganizationDocument } from '@/lib/documents/types';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  WORK_ARTIFACT_KIND_LABELS,
  WORK_ARTIFACT_STATUS_LABELS,
  NO_RECORDED_VISIT,
  type RecordedVisitWindow,
  type WorkArtifactSummary,
  type WorkArtifactTimeSourceOption,
} from '@/lib/work-artifacts/types';
import { useDeviceDrafts, type DraftDevice, type RestoredDraft } from './use-device-drafts';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';
import type { WorkArtifactEvidenceRequirement } from './work-artifact-content';
import { SectionTitle } from '@/components/shared/section-title';

// The dialog and everything only it needs download on the first open: the job list prefetches a
// job page's own code, so a dialog in that code would count toward the field cold start.
const lazyArtifactDialog = lazyDialog(() =>
  import('./work-artifact-dialog').then((mod) => mod.WorkArtifactDialogHost),
);

type WorkArtifactsSectionProps = WorkArtifactTarget & {
  initialArtifacts: WorkArtifactSummary[];
  isManager: boolean;
  canApprove: boolean;
  currentUserId: string;
  documents: OrganizationDocument[];
  evidenceRequirements?: WorkArtifactEvidenceRequirement[];
  timeEntryOptions?: WorkArtifactTimeSourceOption[];
  /** The viewer's recorded time of today on the job: a new work report's Beginn and Ende. */
  recordedVisit?: RecordedVisitWindow;
  instructionOptions?: Array<{ id: string; label: string }>;
  defaultSiteId?: string | undefined;
  readOnly?: boolean;
};

export function WorkArtifactsSection({
  targetType,
  targetId,
  initialArtifacts,
  isManager,
  canApprove,
  currentUserId,
  documents,
  evidenceRequirements = [],
  timeEntryOptions = [],
  recordedVisit = NO_RECORDED_VISIT,
  instructionOptions = [],
  defaultSiteId,
  readOnly = false,
}: WorkArtifactsSectionProps): ReactElement {
  const { selectedId, creating, restoredDraft, ...open } = useOpenArtifact(initialArtifacts);
  // Only a job keeps drafts on the device; their code loads with the dialog for a new Arbeitsnachweis.
  const deviceDrafts = useDeviceDrafts(currentUserId, creating && targetType === 'job');
  const [draftDevice, setDraftDevice] = useState<DraftDevice | null>(null);
  // Newest version seen per artifact while the dialog is open. The dialog
  // compares it with its loaded version, so the user's own writes never
  // raise the remote-change hint.
  const [remoteVersions, setRemoteVersions] = useState<Record<string, number>>({});

  const editing = Boolean(selectedId || creating);
  const view = useWorkArtifactsLiveView({
    targetType,
    targetId,
    initialArtifacts,
    editing,
    setRemoteVersions,
  });
  const artifacts = view.data ?? initialArtifacts;
  const refresh = view.refresh;

  return (
    <section
      id="arbeitsnachweise"
      data-testid="work-artifacts-section"
      className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
    >
      <WorkArtifactsSectionHeader readOnly={readOnly} isManager={isManager} onCreate={open.create} />
      <StaleRegion stale={view.isStale} onRetry={refresh}>
        <WorkArtifactList artifacts={artifacts} onSelect={open.select} />
      </StaleRegion>
      {view.isRefreshing && (
        <p className="mt-2 text-xs text-muted-foreground">Arbeitsnachweise werden aktualisiert…</p>
      )}
      <SectionDeviceDrafts
        deviceDrafts={deviceDrafts}
        currentUserId={currentUserId}
        jobId={targetType === 'job' ? targetId : null}
        onOpen={open.restore}
        onDevice={setDraftDevice}
      />
      <lazyArtifactDialog.Dialog
        open={editing}
        onOpenChange={open.change}
        targetType={targetType}
        targetId={targetId}
        artifactId={selectedId}
        initialSummary={artifacts.find((artifact) => artifact.id === selectedId) ?? null}
        isManager={isManager}
        canApprove={canApprove}
        currentUserId={currentUserId}
        documents={documents}
        evidenceRequirements={evidenceRequirements}
        timeEntryOptions={timeEntryOptions}
        recordedVisit={recordedVisit}
        instructionOptions={instructionOptions}
        defaultSiteId={defaultSiteId}
        readOnly={readOnly}
        draftDevice={targetType === 'job' ? draftDevice : null}
        restoredDraft={restoredDraft}
        remoteVersions={remoteVersions}
        onRemoteUpdateHandled={() => setRemoteVersions({})}
        onClose={() => {
          open.close();
          setRemoteVersions({});
          void refresh();
        }}
      />
    </section>
  );
}

/** The drafts this device keeps, once their code is loaded; code that cannot load shows its retry. */
function SectionDeviceDrafts({
  deviceDrafts: { DeviceDrafts, failure },
  ...drafts
}: {
  deviceDrafts: ReturnType<typeof useDeviceDrafts>;
  currentUserId: string;
  jobId: string | null;
  onOpen: (restored: RestoredDraft) => void;
  onDevice: (device: DraftDevice | null) => void;
}) {
  if (failure) return <SectionError className="mt-4" failure={failure} />;
  return DeviceDrafts ? <DeviceDrafts {...drafts} /> : null;
}

/** Which Arbeitsnachweis the dialog shows: a saved one, a new one, or a draft of this job the device kept. */
function useOpenArtifact(initialArtifacts: WorkArtifactSummary[]) {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const requestedId = searchParams.get('arbeitsnachweis');
    return initialArtifacts.some((artifact) => artifact.id === requestedId) ? requestedId : null;
  });
  const [creating, setCreating] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft | null>(null);
  const close = (): void => {
    setCreating(false);
    setRestoredDraft(null);
    setSelectedId(null);
  };
  return {
    selectedId,
    creating,
    restoredDraft,
    select: setSelectedId,
    create: () => setCreating(true),
    restore: (draft: RestoredDraft) => {
      setRestoredDraft(draft);
      setCreating(true);
    },
    /** The lazy load closes a dialog whose code could not download. */
    change: (next: boolean) => {
      if (!next) close();
    },
    close,
  };
}

type WorkArtifactsLiveViewOptions = WorkArtifactTarget & {
  initialArtifacts: WorkArtifactSummary[];
  editing: boolean;
  setRemoteVersions: Dispatch<SetStateAction<Record<string, number>>>;
};

/** The section's live artifact list; while the dialog is open it records the newest remote versions instead. */
function useWorkArtifactsLiveView({
  targetType,
  targetId,
  initialArtifacts,
  editing,
  setRemoteVersions,
}: WorkArtifactsLiveViewOptions) {
  return useLiveView<WorkArtifactSummary[]>({
    tables: ['work_artifacts'],
    read: async ({ signal }) => {
      const result = await readInBackground('work-artifacts', { targetType, targetId }, signal);
      return result.success ? { ok: true, data: result.artifacts } : { ok: false };
    },
    initialData: initialArtifacts,
    resetKey: `${targetType}:${targetId}`,
    // While the artifact dialog is open, reads queue (one catch-up after
    // close); the in-dialog hint tells the editor a newer version exists.
    suspend: editing,
    eventFilter: (event) => {
      const row = event.new ?? event.old;
      const targetColumn = targetType === 'job' ? 'job_id' : 'project_id';
      const rowTarget = row?.[targetColumn];
      // DELETE payloads carry only id/organization_id — a missing column is relevant.
      if (row && rowTarget !== undefined && rowTarget !== targetId) return false;
      const rowId = row?.id;
      if (editing && typeof rowId === 'string') {
        // A DELETE carries no version, so it always counts as newer.
        const version = typeof row?.version === 'number' ? row.version : Number.MAX_SAFE_INTEGER;
        setRemoteVersions((current) => ({ ...current, [rowId]: Math.max(current[rowId] ?? 0, version) }));
      }
      return true;
    },
  });
}

function WorkArtifactsSectionHeader({
  readOnly,
  isManager,
  onCreate,
}: {
  readOnly: boolean;
  isManager: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <SectionTitle icon={<ClipboardList className="size-4" />}>Arbeitsnachweise</SectionTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Bautagebuch, Arbeitsbericht, Aufmaß, Mangel und Regiearbeit versionssicher erfassen.
        </p>
      </div>
      {!readOnly && (
        <Button size="sm" variant={isManager ? 'default' : 'outline'} className="min-h-11" onClick={onCreate}>
          <Plus className="size-4" />
          Neu
        </Button>
      )}
    </div>
  );
}

function WorkArtifactList({
  artifacts,
  onSelect,
}: {
  artifacts: WorkArtifactSummary[];
  onSelect: (artifactId: string) => void;
}) {
  return artifacts.length === 0 ? (
    <EmptyState size="compact" className="mt-4" title="Noch keine Arbeitsnachweise erfasst." />
  ) : (
    <div className="mt-4 divide-y rounded-md border">
      {artifacts.map((artifact) => (
        <PlainButton
          key={artifact.id}
          type="button"
          data-artifact-id={artifact.id}
          onClick={() => onSelect(artifact.id)}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{artifact.currentRevision.title}</p>
            <p className="text-xs text-muted-foreground">
              {WORK_ARTIFACT_KIND_LABELS[artifact.kind]} · Version {artifact.currentRevision.revision_number}
            </p>
          </div>
          <Badge variant="outline">{WORK_ARTIFACT_STATUS_LABELS[artifact.status]}</Badge>
        </PlainButton>
      ))}
    </div>
  );
}
