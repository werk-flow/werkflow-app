'use client';

import { useState, type DragEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type {
  DocumentContextTarget,
  OrganizationDocument,
  ProjectJobDocumentGroup,
} from '@/lib/documents/types';
import { getContextualAttachTarget, getContextualDocumentLinkContext } from './contextual-documents-context';
import type { ContextualDocumentRowMenuProps } from './contextual-documents-row-menu';
import { useContextualDocumentRowActions } from './use-contextual-documents-row-actions';
import { useContextualDocumentUploads } from './use-contextual-documents-uploads';

export type DocumentRowProps = ContextualDocumentRowMenuProps & {
  indented?: boolean;
};

/** What every row of one list shares; the row adds its document and busy state. */
export type SharedDocumentRowProps = Omit<DocumentRowProps, 'document' | 'isBusy' | 'indented'>;

function useExpandedJobGroups() {
  const [expandedJobGroups, setExpandedJobGroups] = useState<Set<string>>(new Set());

  function toggleJobGroup(jobIdToToggle: string) {
    setExpandedJobGroups((current) => {
      const next = new Set(current);
      if (next.has(jobIdToToggle)) next.delete(jobIdToToggle);
      else next.add(jobIdToToggle);
      return next;
    });
  }

  return { expandedJobGroups, toggleJobGroup };
}

function useDragActive(canUpload: boolean) {
  const [isDragActive, setIsDragActive] = useState(false);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!canUpload) return;
    event.preventDefault();
    setIsDragActive(true);
  }

  return { isDragActive, setIsDragActive, handleDragOver };
}

type ContextualDocumentsSectionStateInput = {
  documents: OrganizationDocument[];
  jobDocumentGroups: ProjectJobDocumentGroup[];
  documentTarget: DocumentContextTarget;
  canUpload: boolean;
  canManage: boolean;
  keepUploadedDocumentsVisible: boolean;
};

export function useContextualDocumentsSectionState({
  documents,
  jobDocumentGroups,
  documentTarget,
  canUpload,
  canManage,
  keepUploadedDocumentsVisible,
}: ContextualDocumentsSectionStateInput) {
  const context = getContextualDocumentLinkContext(documentTarget);
  const attachTarget = canManage ? getContextualAttachTarget(context) : null;
  // Row-scoped pending: the acting row shows a spinner and stays busy until
  // the action's rendered props land, so the rename/unlink/trash result is on screen
  // before the indicator goes away (feedback canon).
  const { isBusy, run: runBusy } = useBusyIds();
  const waitForDocuments = useSettleOnChange(documents);
  const { showBanner } = useBanner();
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [linkDialogDocument, setLinkDialogDocument] = useState<OrganizationDocument | null>(null);
  const jobGroups = useExpandedJobGroups();
  const dragActive = useDragActive(canUpload);
  const uploads = useContextualDocumentUploads({ documents, keepUploadedDocumentsVisible });
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

  // Every document action here revalidates (`revalidateDocuments`), so its
  // response renders the route: no client refresh follows a save.
  const rowActions = useContextualDocumentRowActions({
    runBusy,
    waitForDocuments,
    showBanner,
    setRecentlyUploadedDocuments: uploads.setRecentlyUploadedDocuments,
  });
  const isRenamePending = rowActions.renameDocument ? isBusy(rowActions.renameDocument.id) : false;

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragActive.setIsDragActive(false);
    if (!canUpload) return;
    uploads.handleUpload(event.dataTransfer.files);
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

  return {
    ...jobGroups,
    ...dragActive,
    context,
    attachTarget,
    isBusy,
    attachDialogOpen,
    setAttachDialogOpen,
    linkDialogDocument,
    setLinkDialogDocument,
    uploads,
    viewerDocument,
    setViewerDocument,
    deleteDocumentTarget,
    setDeleteDocumentTarget,
    displayedDocuments,
    totalDocumentCount,
    showFeedback,
    rowActions,
    isRenamePending,
    handleDrop,
    rowProps,
  };
}

export type ContextualDocumentsSectionState = ReturnType<typeof useContextualDocumentsSectionState>;
