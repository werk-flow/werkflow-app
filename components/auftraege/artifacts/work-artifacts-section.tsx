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
import { useLiveView } from '@/hooks/use-live-view';
import { isLeadSignal, withLeadSignal } from '@/lib/projects/work-lead-signal';
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
import {
  noteDraftsOnDevice,
  useArtifactCode,
  type DraftDevice,
  type RestoredDraft,
} from './use-device-drafts';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';
import type { WorkArtifactEvidenceRequirement } from './work-artifact-content';
import { SectionTitle } from '@/components/shared/section-title';

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
  /**
   * The viewer leads the work as its „Projektleitung“ without working on it:
   * no Arbeitsnachweis event reaches them, so the list also reads fresh when
   * their lead holding is touched.
   */
  refreshOnLeadSignal?: boolean;
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
  refreshOnLeadSignal = false,
}: WorkArtifactsSectionProps): ReactElement {
  const { selectedId, editing, restoredDraft, draftDevice, ...open } = useOpenArtifact(initialArtifacts);
  // Newest version seen per artifact while the dialog is open. The dialog
  // compares it with its loaded version, so the user's own writes never
  // raise the remote-change hint.
  const [remoteVersions, setRemoteVersions] = useState<Record<string, number>>({});

  // The dialog and everything only it needs load apart from the job page's own code: the job list
  // prefetches that code, so a dialog in it would count toward the field cold start. A field
  // worker's page loads it once idle, so a first open without signal finds it.
  const { code, failure } = useArtifactCode(currentUserId, editing, !isManager && !readOnly);
  const view = useWorkArtifactsLiveView(
    { targetType, targetId, initialArtifacts, editing, setRemoteVersions },
    refreshOnLeadSignal,
  );
  const artifacts = view.data ?? initialArtifacts;

  return (
    <section
      id="arbeitsnachweise"
      data-testid="work-artifacts-section"
      className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
    >
      <WorkArtifactsSectionHeader readOnly={readOnly} isManager={isManager} onCreate={open.create} />
      <StaleRegion stale={view.isStale} onRetry={view.refresh}>
        <WorkArtifactList artifacts={artifacts} onSelect={open.select} />
      </StaleRegion>
      {view.isRefreshing && (
        <p className="mt-2 text-xs text-muted-foreground">Arbeitsnachweise werden aktualisiert…</p>
      )}
      <SectionDeviceDrafts
        code={code}
        failure={failure}
        currentUserId={currentUserId}
        jobId={targetType === 'job' ? targetId : null}
        onOpen={open.restore}
        onDevice={open.setDraftDevice}
      />
      {code && (
        <code.WorkArtifactDialogHost
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
            void view.refresh();
          }}
        />
      )}
    </section>
  );
}

/** The drafts this device keeps, once the dialog's code is loaded; code that cannot load shows its retry. */
function SectionDeviceDrafts({
  code,
  failure,
  ...drafts
}: ReturnType<typeof useArtifactCode> & {
  currentUserId: string;
  jobId: string | null;
  onOpen: (restored: RestoredDraft) => void;
  onDevice: (device: DraftDevice | null) => void;
}) {
  if (failure) return <SectionError className="mt-4" failure={failure} />;
  return code ? <code.DeviceDrafts {...drafts} noteDrafts={noteDraftsOnDevice} /> : null;
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
  // Only a job keeps drafts on the device; their code loads with the dialog for a new Arbeitsnachweis.
  const [draftDevice, setDraftDevice] = useState<DraftDevice | null>(null);
  const close = (): void => {
    setCreating(false);
    setRestoredDraft(null);
    setSelectedId(null);
  };
  return {
    selectedId,
    editing: Boolean(selectedId || creating),
    restoredDraft,
    draftDevice,
    setDraftDevice,
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
function useWorkArtifactsLiveView(
  { targetType, targetId, initialArtifacts, editing, setRemoteVersions }: WorkArtifactsLiveViewOptions,
  refreshOnLeadSignal: boolean,
) {
  return useLiveView<WorkArtifactSummary[]>({
    tables: withLeadSignal(['work_artifacts'], refreshOnLeadSignal),
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
      if (isLeadSignal(event)) return true;
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
