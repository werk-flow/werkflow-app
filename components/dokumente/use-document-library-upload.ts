'use client';

import { useRef, useState, type DragEvent } from 'react';

import {
  collectFilesFromEntries,
  hasExternalFileDrag,
  hasInternalRowDrag,
  readDroppedEntries,
  type DroppedFile,
} from './document-drop-entries';
import type { DocumentUploadItem } from './document-upload-dialog';

/**
 * The library's upload intake: the hidden file and folder inputs, the drop
 * zone over the whole page, and the queue handed to the upload dialog.
 */
export function useDocumentLibraryUpload({
  canUseUploadActions,
  isNavigationPending,
}: {
  canUseUploadActions: boolean;
  isNavigationPending: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadItemIdRef = useRef(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<DocumentUploadItem[]>([]);

  function buildUploadItems(files: DroppedFile[]): DocumentUploadItem[] {
    return files.map(({ file, relativePath }) => {
      uploadItemIdRef.current += 1;
      return {
        id: `document-upload-${uploadItemIdRef.current}`,
        file,
        relativePath,
      };
    });
  }

  function openUploadDialog(files: DroppedFile[]) {
    if (!canUseUploadActions) return;
    if (files.length === 0) return;
    setUploadItems(buildUploadItems(files));
    setUploadDialogOpen(true);
  }

  function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    openUploadDialog(Array.from(files).map((file) => ({ file })));
  }

  function handleFolderInput(files: FileList | null) {
    if (!files || files.length === 0) return;
    openUploadDialog(
      Array.from(files).map((file) => ({
        file,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      })),
    );
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!canUseUploadActions || isNavigationPending) return;
    if (hasInternalRowDrag(event.dataTransfer)) {
      event.preventDefault();
      return;
    }
    if (!hasExternalFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave() {
    setIsDragActive(false);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (hasInternalRowDrag(event.dataTransfer)) {
      event.preventDefault();
      setIsDragActive(false);
      return;
    }

    if (!hasExternalFileDrag(event.dataTransfer)) {
      setIsDragActive(false);
      return;
    }

    event.preventDefault();
    setIsDragActive(false);
    if (!canUseUploadActions || isNavigationPending) return;

    const entries = readDroppedEntries(event.dataTransfer);

    if (entries.length > 0) {
      openUploadDialog(await collectFilesFromEntries(entries));
      return;
    }

    handleUpload(event.dataTransfer.files);
  }

  /** Empties both inputs so that choosing the same files again fires a change. */
  function resetFileInputs() {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  return {
    fileInputRef,
    folderInputRef,
    isDragActive,
    uploadDialogOpen,
    setUploadDialogOpen,
    uploadItems,
    handleUpload,
    handleFolderInput,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    resetFileInputs,
  };
}
