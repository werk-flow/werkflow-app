'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { EmptyState } from '@/components/ui/empty-state';
import { PlainButton } from '@/components/ui/plain-button';
import { useId, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
import { useLiveView } from '@/hooks/use-live-view';
import type { OrganizationDocument } from '@/lib/documents/types';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  WORK_ARTIFACT_KIND_LABELS,
  WORK_ARTIFACT_STATUS_LABELS,
  type WorkArtifactSummary,
  type WorkArtifactTimeSourceOption,
} from '@/lib/work-artifacts/types';
import { useWorkArtifactCustomerActions } from './use-work-artifact-customer-actions';
import { useWorkArtifactEditor, type WorkArtifactEditor } from './use-work-artifact-editor';
import { useWorkArtifactLinks } from './use-work-artifact-links';
import { useWorkArtifactReviewActions } from './use-work-artifact-review-actions';
import { useWorkArtifactSave } from './use-work-artifact-save';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';
import type { WorkArtifactEvidenceRequirement } from './work-artifact-content';
import { ArtifactDetail } from './work-artifact-detail';
import {
  WorkArtifactDialogActions,
  WorkArtifactDialogSkeleton,
  WorkArtifactDraftForm,
  WorkArtifactRemoteUpdateHint,
} from './work-artifacts-section-dialog-parts';
import { SectionTitle } from '@/components/shared/section-title';

type WorkArtifactsSectionProps = WorkArtifactTarget & {
  initialArtifacts: WorkArtifactSummary[];
  isManager: boolean;
  canApprove: boolean;
  currentUserId: string;
  documents: OrganizationDocument[];
  evidenceRequirements?: WorkArtifactEvidenceRequirement[];
  timeEntryOptions?: WorkArtifactTimeSourceOption[];
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
  instructionOptions = [],
  defaultSiteId,
  readOnly = false,
}: WorkArtifactsSectionProps): ReactElement {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const requestedId = searchParams.get('arbeitsnachweis');
    return initialArtifacts.some((artifact) => artifact.id === requestedId) ? requestedId : null;
  });
  const [creating, setCreating] = useState(false);
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
      <WorkArtifactsSectionHeader
        readOnly={readOnly}
        isManager={isManager}
        onCreate={() => setCreating(true)}
      />
      <StaleRegion stale={view.isStale} onRetry={refresh}>
        <WorkArtifactList artifacts={artifacts} onSelect={setSelectedId} />
      </StaleRegion>
      {view.isRefreshing && (
        <p className="mt-2 text-xs text-muted-foreground">Arbeitsnachweise werden aktualisiert…</p>
      )}
      {(creating || selectedId) && (
        <WorkArtifactDialog
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
          instructionOptions={instructionOptions}
          defaultSiteId={defaultSiteId}
          readOnly={readOnly}
          remoteVersions={remoteVersions}
          onRemoteUpdateHandled={() => setRemoteVersions({})}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
            setRemoteVersions({});
            void refresh();
          }}
        />
      )}
    </section>
  );
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

type WorkArtifactDialogProps = WorkArtifactTarget & {
  artifactId: string | null;
  initialSummary: WorkArtifactSummary | null;
  isManager: boolean;
  canApprove: boolean;
  currentUserId: string;
  documents: OrganizationDocument[];
  evidenceRequirements: WorkArtifactEvidenceRequirement[];
  timeEntryOptions: WorkArtifactTimeSourceOption[];
  instructionOptions: Array<{ id: string; label: string }>;
  defaultSiteId?: string | undefined;
  remoteVersions: Record<string, number>;
  onRemoteUpdateHandled: () => void;
  onClose: () => void;
  readOnly: boolean;
};

function WorkArtifactDialog(props: WorkArtifactDialogProps) {
  const { readOnly } = props;
  const artifactFormId = useId();
  const { editor, save, review, customer, links } = useWorkArtifactDialogActions(props);
  const { detail, loading, editing, isBusy, anyBusy, currentRevision } = editor;
  const { requestClose } = customer;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
      pending={anyBusy}
    >
      <DialogContent size="4xl">
        <DialogHeader>
          <DialogTitle>
            {detail ? (currentRevision?.title ?? 'Arbeitsnachweis') : 'Arbeitsnachweis erstellen'}
          </DialogTitle>
          <DialogDescription>{workArtifactDialogDescription(detail, currentRevision)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5 py-1">
          <WorkArtifactRemoteUpdateHint {...props} editor={editor} />
          {loading ? (
            <WorkArtifactDialogSkeleton />
          ) : !readOnly && editing ? (
            <form
              id={artifactFormId}
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (anyBusy || loading || readOnly || !editing) return;
                save(true);
              }}
              noValidate
            >
              <WorkArtifactDraftForm editor={editor} instructionOptions={props.instructionOptions} />
            </form>
          ) : detail && currentRevision ? (
            <ArtifactDetail
              detail={detail}
              currentRevision={currentRevision}
              currentUserId={props.currentUserId}
              documents={props.documents}
            />
          ) : null}

          <WorkArtifactDialogActions
            {...props}
            editor={editor}
            review={review}
            customer={customer}
            links={links}
          />
        </DialogBody>
        <DialogFooter>
          <WorkArtifactSecondaryActions
            isBusy={isBusy}
            anyBusy={anyBusy}
            canEdit={!readOnly && editing}
            onClose={requestClose}
            onSaveDraft={() => save(false)}
          />
          {!readOnly && editing && (
            <Button
              pending={isBusy('submit')}
              type="submit"
              form={artifactFormId}
              disabled={anyBusy || loading}
            >
              Zur Prüfung einreichen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The editor and the action hooks of one open artifact dialog. */
function useWorkArtifactDialogActions({
  targetType,
  targetId,
  artifactId,
  initialSummary,
  defaultSiteId,
  readOnly,
  timeEntryOptions,
  onClose,
}: WorkArtifactDialogProps) {
  const editor = useWorkArtifactEditor({ artifactId, initialSummary, defaultSiteId, readOnly });
  const save = useWorkArtifactSave({ targetType, targetId, editor });
  const review = useWorkArtifactReviewActions(editor);
  const customer = useWorkArtifactCustomerActions({ targetType, targetId, editor, review, onClose });
  const links = useWorkArtifactLinks({ editor, review, timeEntryOptions });
  return { editor, save, review, customer, links };
}

function workArtifactDialogDescription(
  detail: WorkArtifactEditor['detail'],
  currentRevision: WorkArtifactEditor['currentRevision'],
): string {
  return detail
    ? `${WORK_ARTIFACT_KIND_LABELS[detail.kind]} · ${WORK_ARTIFACT_STATUS_LABELS[detail.status]} · Version ${currentRevision?.revision_number ?? 1}`
    : 'Strukturierte Dokumentation direkt dem aktuellen Auftrag oder Projekt zuordnen.';
}

/** The footer's close and draft actions; the dialog keeps its submit beside its form. */
function WorkArtifactSecondaryActions({
  isBusy,
  anyBusy,
  canEdit,
  onClose,
  onSaveDraft,
}: {
  isBusy: (state: string) => boolean;
  anyBusy: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaveDraft: () => void;
}) {
  return (
    <>
      <Button pending={isBusy('close')} type="button" variant="outline" onClick={onClose} disabled={anyBusy}>
        Schließen
      </Button>
      {canEdit && (
        <Button
          pending={isBusy('draft')}
          type="button"
          variant="outline"
          onClick={onSaveDraft}
          disabled={anyBusy}
        >
          Als Entwurf speichern
        </Button>
      )}
    </>
  );
}
