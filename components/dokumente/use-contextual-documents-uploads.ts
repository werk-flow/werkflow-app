'use client';

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { OrganizationDocument } from '@/lib/documents/types';
import type { DocumentUploadItem } from './document-upload-dialog';

type ContextualDocumentUploads = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploadDialogOpen: boolean;
  setUploadDialogOpen: Dispatch<SetStateAction<boolean>>;
  uploadItems: DocumentUploadItem[];
  setRecentlyUploadedDocuments: Dispatch<SetStateAction<OrganizationDocument[]>>;
  /** The documents to list: the server's, preceded by fresh uploads it has not delivered yet. */
  displayedDocuments: OrganizationDocument[];
  handleUpload: (files: FileList | null) => void;
  /** Resets the file input and remembers the uploaded documents when the list keeps them visible. */
  handleUploadFinished: (uploadedDocuments: OrganizationDocument[]) => void;
};

/**
 * The upload queue of a contextual document list and the documents it
 * uploaded in the last minute, which stay listed until the refreshed props
 * contain them.
 */
export function useContextualDocumentUploads({
  documents,
  keepUploadedDocumentsVisible,
}: {
  documents: OrganizationDocument[];
  keepUploadedDocumentsVisible: boolean;
}): ContextualDocumentUploads {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadItemIdRef = useRef(0);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<DocumentUploadItem[]>([]);
  const [recentlyUploadedDocuments, setRecentlyUploadedDocuments] = useState<OrganizationDocument[]>([]);

  useEffect(() => {
    if (recentlyUploadedDocuments.length === 0) return;
    const timer = window.setTimeout(() => setRecentlyUploadedDocuments([]), 60_000);
    return () => window.clearTimeout(timer);
  }, [recentlyUploadedDocuments]);

  const displayedDocuments = keepUploadedDocumentsVisible
    ? [
        ...recentlyUploadedDocuments.filter(
          (recentDocument) => !documents.some((document) => document.id === recentDocument.id),
        ),
        ...documents,
      ]
    : documents;

  function handleUpload(files: FileList | null): void {
    if (!files || files.length === 0) return;

    setUploadItems(
      Array.from(files).map((file) => {
        uploadItemIdRef.current += 1;
        return {
          id: `context-upload-${uploadItemIdRef.current}`,
          file,
        };
      }),
    );
    setUploadDialogOpen(true);
  }

  function handleUploadFinished(uploadedDocuments: OrganizationDocument[]): void {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (keepUploadedDocumentsVisible) {
      setRecentlyUploadedDocuments((current) => [
        ...uploadedDocuments,
        ...current.filter((document) => !uploadedDocuments.some((uploaded) => uploaded.id === document.id)),
      ]);
    }
  }

  return {
    fileInputRef,
    uploadDialogOpen,
    setUploadDialogOpen,
    uploadItems,
    setRecentlyUploadedDocuments,
    displayedDocuments,
    handleUpload,
    handleUploadFinished,
  };
}
