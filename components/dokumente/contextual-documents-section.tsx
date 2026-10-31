'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { formatGermanDate as formatDate } from '@/lib/utils';
import { formatFileSize } from '@/lib/documents/format';
import type { ReactElement } from 'react';
import { ChevronRight, FileText } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentContextTarget,
  type OrganizationDocument,
  type ProjectJobDocumentGroup,
} from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import { AttachDocumentDialog } from './attach-document-dialog';
import { ContextualDocumentsDeleteDialog } from './contextual-documents-delete-dialog';
import { ContextualDocumentsEmptyState } from './contextual-documents-empty-state';
import { ContextualDocumentsRenameForm } from './contextual-documents-rename-form';
import { ContextualDocumentRowMenu } from './contextual-documents-row-menu';
import {
  useContextualDocumentsSectionState,
  type ContextualDocumentsSectionState,
  type DocumentRowProps,
  type SharedDocumentRowProps,
} from './contextual-documents-section-state';
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

type ContextualDocumentsSectionToolbarProps = {
  section: ContextualDocumentsSectionState;
  emphasizeUpload: boolean;
};

function ContextualDocumentsSectionToolbar({
  section,
  emphasizeUpload,
}: ContextualDocumentsSectionToolbarProps) {
  return (
    <ContextualDocumentsToolbar
      canAttach={section.attachTarget !== null}
      emphasizeUpload={emphasizeUpload}
      fileInputRef={section.uploads.fileInputRef}
      onAttach={() => section.setAttachDialogOpen(true)}
      onFilesSelected={section.uploads.handleUpload}
    />
  );
}

type ContextualDocumentsListingProps = {
  section: ContextualDocumentsSectionState;
  jobDocumentGroups: ProjectJobDocumentGroup[];
  canUpload: boolean;
  contextLabel: string | undefined;
};

function ContextualDocumentsListing({
  section,
  jobDocumentGroups,
  canUpload,
  contextLabel,
}: ContextualDocumentsListingProps): ReactElement {
  const { context, displayedDocuments, isBusy, rowProps } = section;
  if (section.totalDocumentCount === 0) {
    return (
      <ContextualDocumentsEmptyState
        canUpload={canUpload}
        canAttach={section.attachTarget !== null}
        context={context}
        contextLabel={contextLabel}
      />
    );
  }
  if (context.projectId) {
    return (
      <ContextualProjectDocumentGroups
        documents={displayedDocuments}
        jobDocumentGroups={jobDocumentGroups}
        expandedJobGroups={section.expandedJobGroups}
        onToggleJobGroup={section.toggleJobGroup}
        isBusy={isBusy}
        rowProps={rowProps}
      />
    );
  }
  return <ContextualDocumentList documents={displayedDocuments} isBusy={isBusy} rowProps={rowProps} />;
}

type ContextualDocumentsLeadingDialogsProps = {
  section: ContextualDocumentsSectionState;
  documentTarget: DocumentContextTarget;
};

/** The upload, viewer and link dialogs, rendered before the rename dialog. */
function ContextualDocumentsLeadingDialogs({
  section,
  documentTarget,
}: ContextualDocumentsLeadingDialogsProps) {
  const { uploads, showFeedback } = section;
  return (
    <>
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
        }}
      />

      <DocumentViewerDialog
        document={section.viewerDocument}
        open={!!section.viewerDocument}
        onOpenChange={(open) => !open && section.setViewerDocument(null)}
      />

      <DocumentLinkDialog
        key={section.linkDialogDocument?.id ?? 'closed-context-link-dialog'}
        document={section.linkDialogDocument}
        open={!!section.linkDialogDocument}
        onOpenChange={(open) => !open && section.setLinkDialogDocument(null)}
        onComplete={showFeedback}
      />
    </>
  );
}

type ContextualDocumentsTrailingDialogsProps = {
  section: ContextualDocumentsSectionState;
  contextLabel: string | undefined;
};

/** The delete and attach dialogs, rendered after the rename dialog. */
function ContextualDocumentsTrailingDialogs({
  section,
  contextLabel,
}: ContextualDocumentsTrailingDialogsProps) {
  const { attachTarget } = section;
  return (
    <>
      <ContextualDocumentsDeleteDialog
        target={section.deleteDocumentTarget}
        onClose={() => section.setDeleteDocumentTarget(null)}
        onConfirm={section.rowActions.handleTrash}
      />

      {attachTarget && (
        <AttachDocumentDialog
          open={section.attachDialogOpen}
          onOpenChange={section.setAttachDialogOpen}
          targetType={attachTarget.targetType}
          targetId={attachTarget.targetId}
          targetLabel={contextLabel}
          onAttached={section.showFeedback}
        />
      )}
    </>
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
  const section = useContextualDocumentsSectionState({
    documents,
    jobDocumentGroups,
    documentTarget,
    canUpload,
    canManage,
    keepUploadedDocumentsVisible,
  });
  const { rowActions, isRenamePending } = section;

  return (
    <ContextualDocumentsFrame
      data-testid="contextual-documents-section"
      title={title}
      description={description}
      actions={
        canUpload ? (
          <ContextualDocumentsSectionToolbar section={section} emphasizeUpload={emphasizeUpload} />
        ) : undefined
      }
      className={cn(section.isDragActive && 'border-primary bg-primary/5')}
      onDragOver={section.handleDragOver}
      onDragLeave={() => section.setIsDragActive(false)}
      onDrop={section.handleDrop}
    >
      <ContextualDocumentsListing
        section={section}
        jobDocumentGroups={jobDocumentGroups}
        canUpload={canUpload}
        contextLabel={contextLabel}
      />

      <ContextualDocumentsLeadingDialogs section={section} documentTarget={documentTarget} />

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

      <ContextualDocumentsTrailingDialogs section={section} contextLabel={contextLabel} />
    </ContextualDocumentsFrame>
  );
}
