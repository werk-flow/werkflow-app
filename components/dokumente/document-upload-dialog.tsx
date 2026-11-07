'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createDocumentFolder } from '@/lib/documents/folder-actions';
import { usePendingTask } from '@/hooks/use-server-action';
import { uploadDocumentDirect } from '@/lib/documents/upload-client';
import {
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  type DocumentUploadTarget,
  type OrganizationDocument,
} from '@/lib/documents/types';
import {
  DocumentUploadFooter,
  DocumentUploadProgress,
  DocumentUploadRowList,
  failedUploadRow,
  isRetryableUploadRow,
  summarizeUploadProgress,
  useLeavePageWarning,
  type DocumentUploadItem,
  type DocumentUploadRow,
} from './document-upload-rows';

function getFolderSegments(relativePath?: string): string[] {
  if (!relativePath) return [];
  const parts = relativePath.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1) : [];
}

async function ensureUploadTargetFolder(
  allowFolderCreation: boolean,
  target: DocumentUploadTarget,
  folderCache: Map<string, string | null>,
  relativePath?: string,
): Promise<string | null> {
  if (!allowFolderCreation) return target.folderId ?? null;

  const segments = getFolderSegments(relativePath);
  if (segments.length === 0) return target.folderId ?? null;

  let parentFolderId = target.folderId ?? null;
  let currentKey = '';

  for (const segment of segments) {
    currentKey = currentKey ? `${currentKey}/${segment}` : segment;
    if (folderCache.has(currentKey)) {
      parentFolderId = folderCache.get(currentKey) ?? null;
      continue;
    }

    const result = await createDocumentFolder({
      name: segment,
      parentFolderId,
    });

    if (!result.success) {
      throw new Error('folder_failed');
    }

    parentFolderId = result.folder.id;
    folderCache.set(currentKey, parentFolderId);
  }

  return parentFolderId;
}

type DocumentUploadDialogProps = {
  open: boolean;
  title: string;
  description: string;
  rows: DocumentUploadRow[];
  /** True while a file of the list is on its way. */
  isRunning: boolean;
  notice?: ReactNode;
  /** Sends the failed files again; the files that arrived stay as they are. */
  onRetry: () => void;
  /** Stops the running upload after the user confirmed that unfinished files are lost. */
  onCancel: () => void;
  onClose: () => void;
};

/**
 * The listed files of an upload with their progress. A failed file stays
 * listed with its reason until the user retries or closes. Closing or leaving
 * the page while files are on their way asks first.
 */
export function DocumentUploadDialog({
  open,
  title,
  description,
  rows,
  isRunning,
  notice,
  onRetry,
  onCancel,
  onClose,
}: DocumentUploadDialogProps): ReactElement {
  const [cancelRequested, setCancelRequested] = useState(false);
  // A cancel request belongs to the run it interrupted; a later run asks again.
  if (cancelRequested && !isRunning) setCancelRequested(false);
  const confirmingCancel = cancelRequested && isRunning;
  const { completedCount, progressPercentage } = summarizeUploadProgress(rows);
  useLeavePageWarning(open && isRunning);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      pending={isRunning}
    >
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <DocumentUploadProgress
            completedCount={completedCount}
            totalCount={rows.length}
            progressPercentage={progressPercentage}
          />
          {notice}
          <DocumentUploadRowList rows={rows} />
          {confirmingCancel && (
            <ErrorText className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              Dateien, die noch nicht hochgeladen sind, gehen verloren.
            </ErrorText>
          )}
        </div>

        <DocumentUploadFooter
          isRunning={isRunning}
          confirmingCancel={confirmingCancel}
          canRetry={rows.some(isRetryableUploadRow)}
          onConfirmCancel={() => setCancelRequested(true)}
          onKeepUploading={() => setCancelRequested(false)}
          onCancel={() => {
            setCancelRequested(false);
            onCancel();
          }}
          onRetry={onRetry}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function uploadItemsKey(items: DocumentUploadItem[]): string {
  return items
    .map((item) => `${item.id}:${item.file.name}:${item.file.size}:${item.file.lastModified}`)
    .join('|');
}

function initialUploadRows(items: DocumentUploadItem[]): DocumentUploadRow[] {
  return items.map((item) =>
    item.file.size > DOCUMENT_MAX_FILE_SIZE_BYTES
      ? { ...item, status: 'error', failure: 'too_large', transferred: null }
      : { ...item, status: 'queued', transferred: null },
  );
}

type UploadQueueOptions = {
  allowFolderCreation: boolean;
  target: DocumentUploadTarget;
  folderCache: Map<string, string | null>;
  signal: AbortSignal;
  updateRow: (id: string, update: Partial<DocumentUploadRow>) => void;
};

/**
 * Uploads the queued rows one after another and reports each row's state
 * through `updateRow`. A cancelled queue starts no further row and counts
 * each one it skipped as failed.
 */
async function uploadQueuedRows(
  queuedRows: DocumentUploadRow[],
  { allowFolderCreation, target, folderCache, signal, updateRow }: UploadQueueOptions,
) {
  let failures = 0;
  const uploadedDocuments: OrganizationDocument[] = [];

  for (const row of queuedRows) {
    if (row.status === 'error' || signal.aborted) {
      failures++;
      continue;
    }

    updateRow(row.id, { status: 'uploading', progress: 0 });

    let folderId: string | null;
    try {
      folderId = await ensureUploadTargetFolder(allowFolderCreation, target, folderCache, row.relativePath);
    } catch {
      failures++;
      updateRow(row.id, failedUploadRow('folder_failed', row.transferred));
      continue;
    }
    const outcome = await uploadDocumentDirect({
      file: row.file,
      target: { ...target, folderId },
      ...(row.category ? { category: row.category } : {}),
      transferred: row.transferred,
      onProgress: (fraction) => updateRow(row.id, { progress: fraction }),
      signal,
    });
    if (outcome.status === 'failed') {
      failures++;
      updateRow(row.id, failedUploadRow(outcome.reason, outcome.transferred));
      continue;
    }

    if (outcome.saved) uploadedDocuments.push(outcome.saved);
    updateRow(row.id, { status: 'done', transferred: null });
  }

  return { failures, uploadedDocuments };
}

type DocumentBatchUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  items: DocumentUploadItem[];
  target: DocumentUploadTarget;
  allowFolderCreation?: boolean;
  /** Called after each run, also a retry or a cancelled one, with the files that are still missing. */
  onComplete: (failedCount: number, uploadedDocuments: OrganizationDocument[]) => void;
};

/** The rows a retry sends again, queued, and the listed failures it leaves alone. */
function planRetry(rows: DocumentUploadRow[]) {
  const nextRows = rows.map(
    (row): DocumentUploadRow =>
      isRetryableUploadRow(row) ? { ...row, status: 'queued', failure: undefined } : row,
  );
  const retryRows = nextRows.filter((row, index) => row !== rows[index]);
  return {
    nextRows,
    retryRows,
    settledFailures: nextRows.filter((row) => row.status === 'error').length,
  };
}

/** Closes the dialog shortly after a run saved every file, so the per-file success marks are seen. */
function useSuccessClose() {
  const closeTimeoutRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (closeTimeoutRef.current === null) return;

    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  }, []);

  useEffect(() => () => clear(), [clear]);

  function schedule(onClose: () => void) {
    clear();
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      onClose();
    }, 650);
  }

  return { clear, schedule };
}

function useDocumentUploadQueue(
  input: Required<Omit<DocumentBatchUploadDialogProps, 'title' | 'description'>>,
) {
  const { open, onOpenChange, items, target, allowFolderCreation, onComplete } = input;
  const { run: runUploadTask, isPending } = usePendingTask();
  const [rows, setRows] = useState<DocumentUploadRow[]>([]);
  const [hasStarted, setHasStarted] = useState(false);
  const successClose = useSuccessClose();
  const startedItemsKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Folders a dropped folder created, kept for a retry of the same batch.
  const folderCacheRef = useRef(new Map<string, string | null>());
  const itemsKey = useMemo(() => uploadItemsKey(items), [items]);

  function updateRow(id: string, update: Partial<DocumentUploadRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
  }

  /** Uploads `queuedRows`; `settledFailures` are the listed failures this run does not retry. */
  function runQueue(queuedRows: DocumentUploadRow[], settledFailures: number) {
    const controller = new AbortController();
    abortRef.current = controller;
    successClose.clear();

    void runUploadTask(async () => {
      const { failures, uploadedDocuments } = await uploadQueuedRows(queuedRows, {
        allowFolderCreation,
        target,
        folderCache: folderCacheRef.current,
        signal: controller.signal,
        updateRow,
      });

      onComplete(settledFailures + failures, uploadedDocuments);
      if (settledFailures + failures === 0 && !controller.signal.aborted) {
        successClose.schedule(() => handleOpenChange(false));
      }
    });
  }

  function handleStartUpload() {
    const initialRows = initialUploadRows(items);

    setRows(initialRows);
    setHasStarted(true);
    startedItemsKeyRef.current = itemsKey;
    folderCacheRef.current = new Map();
    runQueue(initialRows, 0);
  }

  function handleRetry() {
    const { retryRows, settledFailures, nextRows } = planRetry(rows);
    setRows(nextRows);
    runQueue(retryRows, settledFailures);
  }

  useEffect(() => {
    if (!open || hasStarted || isPending || items.length === 0) return;
    handleStartUpload();
    // handleStartUpload intentionally owns the mutable upload queue for this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rerunning on handleStartUpload's identity would restart the upload queue it owns
  }, [open, hasStarted, isPending, items.length, itemsKey]);

  const clearSuccessClose = successClose.clear;
  useEffect(() => {
    if (!open || isPending || items.length === 0) return;
    if (!hasStarted || startedItemsKeyRef.current === itemsKey) return;

    setRows([]);
    setHasStarted(false);
    clearSuccessClose();
  }, [clearSuccessClose, hasStarted, isPending, items.length, itemsKey, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      successClose.clear();
      setRows([]);
      setHasStarted(false);
      startedItemsKeyRef.current = null;
    }
    onOpenChange(nextOpen);
  }

  const isComplete = hasStarted && rows.every((row) => row.status === 'done' || row.status === 'error');
  return {
    rows: hasStarted ? rows : initialUploadRows(items),
    isRunning: isPending && !isComplete,
    hasStarted,
    handleRetry,
    handleCancel: () => {
      abortRef.current?.abort();
      handleOpenChange(false);
    },
    handleOpenChange,
  };
}

/** The upload of chosen or dropped files into the library or onto a record. */
export function DocumentBatchUploadDialog({
  title = 'Dateien hochladen',
  description = 'Die Dateien werden automatisch hochgeladen.',
  allowFolderCreation = false,
  ...props
}: DocumentBatchUploadDialogProps): ReactElement {
  const queue = useDocumentUploadQueue({ ...props, allowFolderCreation });
  const oversizedCount = props.items.filter((item) => item.file.size > DOCUMENT_MAX_FILE_SIZE_BYTES).length;

  return (
    <DocumentUploadDialog
      open={props.open}
      title={title}
      description={description}
      rows={queue.rows}
      isRunning={queue.isRunning}
      notice={
        oversizedCount > 0 &&
        !queue.hasStarted && (
          <ErrorText className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            {oversizedCount} Datei(en) sind größer als 50 MB und werden nicht hochgeladen.
          </ErrorText>
        )
      }
      onRetry={queue.handleRetry}
      onCancel={queue.handleCancel}
      onClose={() => queue.handleOpenChange(false)}
    />
  );
}
