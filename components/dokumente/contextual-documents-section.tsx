'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { formatGermanDate as formatDate } from '@/lib/utils';
import { formatFileSize } from '@/lib/documents/format';
import { useState, type DragEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, FileText } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentContextTarget,
  type OrganizationDocument,
  type ProjectJobDocumentGroup,
} from '@/lib/documents/types';
import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { cn } from '@/lib/utils';
import { AttachDocumentDialog } from './attach-document-dialog';
import { getContextualAttachTarget, getContextualDocumentLinkContext } from './contextual-documents-context';
import { ContextualDocumentsDeleteDialog } from './contextual-documents-delete-dialog';
import { ContextualDocumentsEmptyState } from './contextual-documents-empty-state';
import { ContextualDocumentsRenameForm } from './contextual-documents-rename-form';
import {
  ContextualDocumentRowMenu,
  type ContextualDocumentRowMenuProps,
} from './contextual-documents-row-menu';
import { ContextualDocumentsToolbar } from './contextual-documents-toolbar';
import { DocumentLinkDialog } from './document-link-dialog';
import { DocumentUploadDialog } from './document-upload-dialog';
import { DocumentViewerDialog } from './document-viewer-dialog';
import {
  ContextualDocumentsFrame,
  ContextualDocumentRowFrame,
  CONTEXTUAL_DOCUMENT_LIST_CLASS,
  CONTEXTUAL_DOCUMENTS_EMPHASIZE_UPLOAD,
} from './contextual-documents-layout';
import { useContextualDocumentRowActions } from './use-contextual-documents-row-actions';
import { useContextualDocumentUploads } from './use-contextual-documents-uploads';

type ContextualDocumentsSectionProps = {
  title: string;
  description: string;
  documents: OrganizationDocument[];
  jobDocumentGroups?: ProjectJobDocumentGroup[];
  documentTarget: DocumentContextTarget;
  contextLabel?: string;
  canUpload: boolean;
  canManage: boolean;
  emphasizeUpload?: boolean;
  keepUploadedDocumentsVisible?: boolean;
};

type DocumentRowProps = ContextualDocumentRowMenuProps & {
  indented?: boolean;
};

/** What every row of one list shares; the row adds its document and busy state. */
type SharedDocumentRowProps = Omit<DocumentRowProps, 'document' | 'isBusy' | 'indented'>;

function DocumentRow({ indented = false, ...menuProps }: DocumentRowProps) {
  const { document, isBusy, onOpen } = menuProps;
  return (
    <ContextualDocumentRowFrame indented={indented} rowId={document.id}>
      <PlainButton type="button" onClick={() => onOpen(document)} className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{document.displayName}</span>
          <InlinePending active={isBusy} />
        </span>
        <span className="ml-6 mt-0.5 block text-xs text-muted-foreground">
          {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)} ·{' '}
          {formatDate(document.updatedAt)}
          {document.links.length > 1 ? ` · ${document.links.length} Verknüpfungen` : ''}
        </span>
      </PlainButton>

      <ContextualDocumentRowMenu {...menuProps} />
    </ContextualDocumentRowFrame>
  );
}

function ContextualDocumentList({
  documents,
  isBusy,
  rowProps,
}: {
  documents: OrganizationDocument[];
  isBusy: (documentId: string) => boolean;
  rowProps: SharedDocumentRowProps;
}): ReactElement {
  return (
    <div className={CONTEXTUAL_DOCUMENT_LIST_CLASS}>
      {documents.map((document) => (
        <DocumentRow key={document.id} document={document} isBusy={isBusy(document.id)} {...rowProps} />
      ))}
    </div>
  );
}

/** A project's own documents, followed by its jobs as expandable groups. */
function ContextualProjectDocumentGroups({
  documents,
  jobDocumentGroups,
  expandedJobGroups,
  onToggleJobGroup,
  isBusy,
  rowProps,
}: {
  documents: OrganizationDocument[];
  jobDocumentGroups: ProjectJobDocumentGroup[];
  expandedJobGroups: Set<string>;
  onToggleJobGroup: (jobId: string) => void;
  isBusy: (documentId: string) => boolean;
  rowProps: SharedDocumentRowProps;
}): ReactElement {
  return (
    <div className="space-y-3">
      {documents.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Projektdateien
          </p>
          <ContextualDocumentList documents={documents} isBusy={isBusy} rowProps={rowProps} />
        </div>
      )}

      {jobDocumentGroups.map((group) => {
        const isExpanded = expandedJobGroups.has(group.jobId);
        const jobLabel = group.jobNumber ? `${group.jobNumber} · ${group.jobTitle}` : group.jobTitle;

        return (
          <div key={group.jobId} className="rounded-md border">
            <PlainButton
              type="button"
              onClick={() => onToggleJobGroup(group.jobId)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
            >
              <ChevronRight
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                  isExpanded && 'rotate-90',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{jobLabel}</span>
                <span className="block text-xs text-muted-foreground">
                  {group.documents.length} {group.documents.length === 1 ? 'Datei' : 'Dateien'}
                </span>
              </span>
            </PlainButton>
            {isExpanded && (
              <div className="divide-y border-t">
                {group.documents.map((document) => (
                  <DocumentRow
                    key={document.id}
                    document={document}
                    isBusy={isBusy(document.id)}
                    indented
                    {...rowProps}
                    context={{ jobId: group.jobId }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ContextualDocumentsSection({
  title,
  description,
  documents,
  jobDocumentGroups = [],
  documentTarget,
  contextLabel,
  canUpload,
  canManage,
  emphasizeUpload = CONTEXTUAL_DOCUMENTS_EMPHASIZE_UPLOAD,
  keepUploadedDocumentsVisible = false,
}: ContextualDocumentsSectionProps): ReactElement {
  const context = getContextualDocumentLinkContext(documentTarget);
  const attachTarget = canManage ? getContextualAttachTarget(context) : null;
  const router = useRouter();
  // Row-scoped pending: the acting row shows a spinner and stays busy until
  // the refreshed props land, so the rename/unlink/trash result is on screen
  // before the indicator goes away (feedback canon).
  const { isBusy, run: runBusy } = useBusyIds();
  const waitForDocuments = useSettleOnChange(documents);
  const { showBanner } = useBanner();
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [linkDialogDocument, setLinkDialogDocument] = useState<OrganizationDocument | null>(null);
  const [expandedJobGroups, setExpandedJobGroups] = useState<Set<string>>(new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const uploads = useContextualDocumentUploads({
    documents,
    keepUploadedDocumentsVisible,
  });
  const [viewerDocument, setViewerDocument] = useState<OrganizationDocument | null>(null);
  const [deleteDocumentTarget, setDeleteDocumentTarget] = useState<OrganizationDocument | null>(null);
  const { displayedDocuments } = uploads;
  const totalDocumentCount =
    displayedDocuments.length + jobDocumentGroups.reduce((total, group) => total + group.documents.length, 0);

  useRealtimeRouterRefresh({
    tables: ['documents', 'document_links', 'document_audit_events', 'document_versions'],
  });

  function showFeedback(variant: 'success' | 'error', message: string) {
    showBanner({ variant, message });
  }

  async function settleAfterRefresh() {
    router.refresh();
    await waitForDocuments();
  }

  const rowActions = useContextualDocumentRowActions({
    runBusy,
    settleAfterRefresh,
    showBanner,
    setRecentlyUploadedDocuments: uploads.setRecentlyUploadedDocuments,
  });
  const isRenamePending = rowActions.renameDocument ? isBusy(rowActions.renameDocument.id) : false;

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    if (!canUpload) return;
    uploads.handleUpload(event.dataTransfer.files);
  }

  function toggleJobGroup(jobIdToToggle: string) {
    setExpandedJobGroups((current) => {
      const next = new Set(current);
      if (next.has(jobIdToToggle)) next.delete(jobIdToToggle);
      else next.add(jobIdToToggle);
      return next;
    });
  }

  const rowProps: SharedDocumentRowProps = {
    canManage,
    context,
    onOpen: setViewerDocument,
    onManageLinks: setLinkDialogDocument,
    onRename: rowActions.startRename,
    onUnlink: rowActions.handleUnlink,
    onDelete: setDeleteDocumentTarget,
  };

  return (
    <ContextualDocumentsFrame
      data-testid="contextual-documents-section"
      title={title}
      description={description}
      actions={
        canUpload ? (
          <ContextualDocumentsToolbar
            canAttach={attachTarget !== null}
            emphasizeUpload={emphasizeUpload}
            fileInputRef={uploads.fileInputRef}
            onAttach={() => setAttachDialogOpen(true)}
            onFilesSelected={uploads.handleUpload}
          />
        ) : undefined
      }
      className={cn(isDragActive && 'border-primary bg-primary/5')}
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
    >
      {totalDocumentCount === 0 ? (
        <ContextualDocumentsEmptyState
          canUpload={canUpload}
          canAttach={attachTarget !== null}
          context={context}
          contextLabel={contextLabel}
        />
      ) : context.projectId ? (
        <ContextualProjectDocumentGroups
          documents={displayedDocuments}
          jobDocumentGroups={jobDocumentGroups}
          expandedJobGroups={expandedJobGroups}
          onToggleJobGroup={toggleJobGroup}
          isBusy={isBusy}
          rowProps={rowProps}
        />
      ) : (
        <ContextualDocumentList documents={displayedDocuments} isBusy={isBusy} rowProps={rowProps} />
      )}

      <DocumentUploadDialog
        open={uploads.uploadDialogOpen}
        onOpenChange={uploads.setUploadDialogOpen}
        items={uploads.uploadItems}
        target={documentTarget}
        onComplete={(failedCount, uploadedDocuments) => {
          if (failedCount > 0) {
            showFeedback('error', `${failedCount} Datei(en) konnten nicht hochgeladen werden.`);
          }
          uploads.handleUploadFinished(uploadedDocuments);
          router.refresh();
        }}
      />

      <DocumentViewerDialog
        document={viewerDocument}
        open={!!viewerDocument}
        onOpenChange={(open) => !open && setViewerDocument(null)}
      />

      <DocumentLinkDialog
        key={linkDialogDocument?.id ?? 'closed-context-link-dialog'}
        document={linkDialogDocument}
        open={!!linkDialogDocument}
        onOpenChange={(open) => !open && setLinkDialogDocument(null)}
        onComplete={(variant, message) => {
          showFeedback(variant, message);
          router.refresh();
        }}
      />

      <Dialog
        open={!!rowActions.renameDocument}
        onOpenChange={(open) => {
          if (open) return;
          rowActions.closeRenameDialog();
        }}
        pending={isRenamePending}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Datei umbenennen</DialogTitle>
            <DialogDescription>
              Vergib einen klaren Namen, damit das Dokument später leicht gefunden wird.
            </DialogDescription>
          </DialogHeader>
          <ContextualDocumentsRenameForm
            value={rowActions.renameValue}
            error={rowActions.renameError}
            isPending={isRenamePending}
            onValueChange={rowActions.setRenameValue}
            onCancel={rowActions.cancelRename}
            onSubmit={rowActions.handleRenameConfirm}
          />
        </DialogContent>
      </Dialog>

      <ContextualDocumentsDeleteDialog
        target={deleteDocumentTarget}
        onClose={() => setDeleteDocumentTarget(null)}
        onConfirm={rowActions.handleTrash}
      />

      {attachTarget && (
        <AttachDocumentDialog
          open={attachDialogOpen}
          onOpenChange={setAttachDialogOpen}
          targetType={attachTarget.targetType}
          targetId={attachTarget.targetId}
          targetLabel={contextLabel}
          onAttached={(variant, message) => {
            showFeedback(variant, message);
            router.refresh();
          }}
        />
      )}
    </ContextualDocumentsFrame>
  );
}
