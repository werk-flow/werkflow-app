'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { useId, useState, type ReactElement } from 'react';
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
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
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
import { WorkArtifactActionPanel } from './work-artifact-action-panel';
import type { WorkArtifactEvidenceRequirement, WorkArtifactTarget } from './work-artifact-content';
import { ArtifactDetail } from './work-artifact-detail';
import { ArtifactForm } from './work-artifact-form';
import { SectionTitle } from '@/components/shared/section-title';

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
}: WorkArtifactTarget & {
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
}): ReactElement {
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
  const view = useLiveView<WorkArtifactSummary[]>({
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
  const artifacts = view.data ?? initialArtifacts;
  const refresh = view.refresh;

  return (
    <section
      id="arbeitsnachweise"
      data-testid="work-artifacts-section"
      className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle icon={<ClipboardList className="size-4" />}>Arbeitsnachweise</SectionTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Bautagebuch, Arbeitsbericht, Aufmaß, Mangel und Regiearbeit versionssicher erfassen.
          </p>
        </div>
        {!readOnly && (
          <Button
            size="sm"
            variant={isManager ? 'default' : 'outline'}
            className="min-h-11"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" />
            Neu
          </Button>
        )}
      </div>
      {artifacts.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Arbeitsnachweise erfasst.
        </p>
      ) : (
        <div className="mt-4 divide-y rounded-md border">
          {artifacts.map((artifact) => (
            <PlainButton
              key={artifact.id}
              type="button"
              data-artifact-id={artifact.id}
              onClick={() => setSelectedId(artifact.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{artifact.currentRevision.title}</p>
                <p className="text-xs text-muted-foreground">
                  {WORK_ARTIFACT_KIND_LABELS[artifact.kind]} · Version{' '}
                  {artifact.currentRevision.revision_number}
                </p>
              </div>
              <Badge variant="outline">{WORK_ARTIFACT_STATUS_LABELS[artifact.status]}</Badge>
            </PlainButton>
          ))}
        </div>
      )}
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

// A failed read of the artifact offers its retry in place; the last-known detail stays visible.
function ArtifactLoadError({
  editor,
  artifactId,
}: {
  editor: WorkArtifactEditor;
  artifactId: string | null;
}) {
  const { loadFailed, loading, detail, load, runArtifactTask, isBusy } = editor;
  const loadTargetId = detail?.id ?? artifactId;
  if (!loadFailed || loading || !loadTargetId) return null;
  return (
    <SectionError
      onRetry={() => void runArtifactTask('reload', () => load(loadTargetId))}
      retryPending={isBusy('reload')}
    >
      Der Arbeitsnachweis konnte nicht geladen werden.
    </SectionError>
  );
}

function WorkArtifactDialog({
  targetType,
  targetId,
  artifactId,
  initialSummary,
  isManager,
  canApprove,
  currentUserId,
  documents,
  evidenceRequirements,
  onClose,
  timeEntryOptions,
  instructionOptions,
  defaultSiteId,
  remoteVersions,
  onRemoteUpdateHandled,
  readOnly,
}: WorkArtifactTarget & {
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
}) {
  const artifactFormId = useId();
  const editor = useWorkArtifactEditor({ artifactId, initialSummary, defaultSiteId, readOnly });
  const save = useWorkArtifactSave({ targetType, targetId, editor });
  const review = useWorkArtifactReviewActions(editor);
  const customer = useWorkArtifactCustomerActions({ targetType, targetId, editor, review, onClose });
  const links = useWorkArtifactLinks({ editor, review, timeEntryOptions });
  const {
    detail,
    loading,
    editing,
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
    error,
    runArtifactTask,
    isBusy,
    anyBusy,
    load,
    currentRevision,
    requiresCorrectionReason,
    measurementLines,
    patchContent,
  } = editor;
  const { requestClose } = customer;
  const remoteVersion = detail ? remoteVersions[detail.id] : undefined;
  const hasRemoteUpdate = detail !== null && remoteVersion !== undefined && remoteVersion > detail.version;

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
          <DialogDescription>
            {detail
              ? `${WORK_ARTIFACT_KIND_LABELS[detail.kind]} · ${WORK_ARTIFACT_STATUS_LABELS[detail.status]} · Version ${currentRevision?.revision_number ?? 1}`
              : 'Strukturierte Dokumentation direkt dem aktuellen Auftrag oder Projekt zuordnen.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5 py-1">
          {hasRemoteUpdate && detail && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <p>Dieser Arbeitsnachweis wurde zwischenzeitlich geändert.</p>
              <Button
                pending={isBusy('reload')}
                type="button"
                size="sm"
                variant="outline"
                disabled={anyBusy}
                onClick={() => {
                  void runArtifactTask('reload', async () => {
                    await load(detail.id);
                    onRemoteUpdateHandled();
                  });
                }}
              >
                Aktualisieren
              </Button>
            </div>
          )}
          {loading ? (
            <div className="min-h-48 space-y-4" role="status" aria-busy="true">
              <span className="sr-only">Arbeitsnachweis wird geladen.</span>
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
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
              <ArtifactForm
                kind={kind}
                setKind={setKind}
                lockedKind={Boolean(detail)}
                visibility={visibility}
                setVisibility={setVisibility}
                title={title}
                setTitle={setTitle}
                capturedAt={capturedAt}
                setCapturedAt={setCapturedAt}
                content={content}
                patchContent={patchContent}
                measurementLines={measurementLines}
                setMeasurementLines={(lines) => patchContent({ measurementLines: lines })}
                instructionOptions={instructionOptions}
                requiresCorrectionReason={requiresCorrectionReason}
                correctionReason={correctionReason}
                correctionReasonError={correctionReasonError}
                setCorrectionReason={setCorrectionReason}
              />
            </form>
          ) : detail && currentRevision ? (
            <ArtifactDetail
              detail={detail}
              currentRevision={currentRevision}
              currentUserId={currentUserId}
              documents={documents}
            />
          ) : null}

          {!readOnly && !editing && detail && currentRevision && detail.status !== 'voided' && (
            <WorkArtifactActionPanel
              detail={detail}
              currentRevision={currentRevision}
              editor={editor}
              review={review}
              customer={customer}
              links={links}
              isManager={isManager}
              canApprove={canApprove}
              currentUserId={currentUserId}
              documents={documents}
              timeEntryOptions={timeEntryOptions}
              evidenceRequirements={evidenceRequirements}
            />
          )}
          <ArtifactLoadError editor={editor} artifactId={artifactId} />
          <ErrorText>{error}</ErrorText>
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
