'use client';

import { useRef, useState } from 'react';

import { getDocumentDetails, updateDocumentCategory } from '@/lib/documents/actions';
import type { DocumentCategory, DocumentDetailsResult, OrganizationDocument } from '@/lib/documents/types';
import type { DocumentLibraryMutations } from './use-document-library-mutations';

export type LoadedDocumentDetails = Extract<DocumentDetailsResult, { success: true }>;

export type DocumentDetailsDialogState = ReturnType<typeof useDocumentDetailsDialog>;

/**
 * State of the „Dateidetails" dialog: the document it shows, its loaded
 * versions and audit events, and the category change. `detailsDialogIdRef`
 * names the document the dialog shows now, so a late response for another
 * document is dropped.
 */
export function useDocumentDetailsDialog({
  isTrashView,
  mutations,
}: {
  isTrashView: boolean;
  mutations: DocumentLibraryMutations;
}) {
  const { busy, refreshDocuments } = mutations;
  const [detailsDialog, setDetailsDialog] = useState<OrganizationDocument | null>(null);
  const detailsDialogIdRef = useRef<string | null>(null);
  const [detailsData, setDetailsData] = useState<LoadedDocumentDetails | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const isDetailsBusy = detailsDialog ? busy.isBusy(detailsDialog.id) : false;

  function openDetailsDialog(document: OrganizationDocument) {
    detailsDialogIdRef.current = document.id;
    setDetailsDialog(document);
    setDetailsData(null);
    setDetailsError(null);
    setIsDetailsLoading(true);

    void getDocumentDetails(document.id)
      .then((result) => {
        // The dialog may have moved on to another document meanwhile.
        if (detailsDialogIdRef.current !== document.id) return;
        setIsDetailsLoading(false);
        // A failed read leaves `detailsData` empty; the dialog shows it with a retry.
        if (!result.success) return;
        // The table row that seeded this dialog is mount-time data; the fetch
        // is the authority (freshness contract rule 3). Reopening right after
        // a mutation must not show the pre-mutation row while the route
        // refresh is still rendering.
        setDetailsDialog(result.document);
        setDetailsData(result);
      })
      .catch(() => {
        if (detailsDialogIdRef.current !== document.id) return;
        setIsDetailsLoading(false);
      });
  }

  function closeDetailsDialog() {
    detailsDialogIdRef.current = null;
    setDetailsDialog(null);
    setDetailsData(null);
    setDetailsError(null);
    setIsDetailsLoading(false);
  }

  // The select flips at once; a failure puts the previous category back and
  // explains itself beside the control.
  function handleUpdateCategory(document: OrganizationDocument, category: DocumentCategory) {
    if (isTrashView) return;
    const categoryFailure = 'Die Kategorie konnte nicht geändert werden.';
    const revert = () => {
      if (detailsDialogIdRef.current !== document.id) return;
      setDetailsDialog(document);
      setDetailsError(categoryFailure);
    };
    setDetailsError(null);
    setDetailsDialog({ ...document, category });
    void busy
      .run(document.id, async () => {
        const result = await updateDocumentCategory({
          documentId: document.id,
          category,
        });
        if (!result.success) {
          revert();
          return;
        }
        if (detailsDialogIdRef.current === document.id) {
          setDetailsDialog(result.document);
        }
        refreshDocuments();
      })
      .catch(revert);
  }

  return {
    detailsDialog,
    setDetailsDialog,
    detailsDialogIdRef,
    detailsData,
    setDetailsData,
    isDetailsLoading,
    setIsDetailsLoading,
    detailsError,
    setDetailsError,
    isDetailsBusy,
    openDetailsDialog,
    closeDetailsDialog,
    handleUpdateCategory,
  };
}
