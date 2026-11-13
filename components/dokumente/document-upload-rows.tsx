'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { CheckCircle, FileText, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { Spinner } from '@/components/ui/spinner';
import { formatFileSize } from '@/lib/documents/format';
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from '@/lib/documents/types';
import type { TransferredUpload, UploadFailureReason } from '@/lib/documents/upload-client';

// The listed files of an upload dialog: each file's state, the failure
// reasons in German, the overall progress and the footer commands.

export type DocumentUploadItem = {
  id: string;
  file: File;
  relativePath?: string | undefined;
  category?: DocumentCategory;
};

type DocumentUploadFailure = UploadFailureReason | 'folder_failed';

/** One listed file. A failed row keeps its reason and the bytes an earlier try already stored. */
export type DocumentUploadRow = DocumentUploadItem & {
  status: 'queued' | 'uploading' | 'done' | 'error';
  progress?: number;
  failure?: DocumentUploadFailure | undefined;
  transferred: TransferredUpload | null;
};

const FAILURE_TEXT: Record<DocumentUploadFailure, string> = {
  interrupted: 'Die Übertragung wurde unterbrochen.',
  timeout: 'Die Übertragung hat zu lange gedauert.',
  storage_refused: 'Der Speicher hat die Datei nicht angenommen.',
  too_large: 'Die Datei ist größer als 50 MB.',
  empty: 'Die Datei ist leer.',
  refused: 'Die Datei wurde abgelehnt. Prüfe, ob das Ziel noch existiert.',
  not_saved: 'Die Datei konnte nicht gespeichert werden.',
  version_conflict: 'Inzwischen wurde eine neuere Version gespeichert. Prüfe die Versionen.',
  document_filed: 'Die Datei wurde inzwischen festgeschrieben und nimmt keine neue Version mehr an.',
  folder_failed: 'Der Zielordner konnte nicht angelegt werden.',
  uploader_changed: 'Inzwischen ist eine andere Person angemeldet. Die Datei wurde nicht gespeichert.',
};

/** A failure another try of the same file cannot fix. */
const FINAL_FAILURES: ReadonlySet<DocumentUploadFailure> = new Set([
  'too_large',
  'empty',
  'version_conflict',
  'document_filed',
]);

/** A failed row the retry sends again. */
export function isRetryableUploadRow(row: DocumentUploadRow): boolean {
  return row.status === 'error' && row.failure !== undefined && !FINAL_FAILURES.has(row.failure);
}

/** Marks a row failed with the outcome's reason, keeping the bytes it stored. */
export function failedUploadRow(
  failure: DocumentUploadFailure,
  transferred: TransferredUpload | null,
): Partial<DocumentUploadRow> {
  return { status: 'error', failure, transferred };
}

export function DocumentUploadProgress({
  completedCount,
  totalCount,
  progressPercentage,
}: {
  completedCount: number;
  totalCount: number;
  progressPercentage: number;
}): ReactElement {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span aria-live="polite">
          {completedCount} von {totalCount} abgeschlossen
        </span>
        <span>{progressPercentage}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Gesamtfortschritt des Uploads"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercentage}
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>
    </div>
  );
}

export function DocumentUploadRowList({ rows }: { rows: DocumentUploadRow[] }): ReactElement {
  return (
    <div className="max-h-80 overflow-y-auto rounded-md border">
      {rows.length === 0 ? (
        <EmptyState title="Keine Dateien ausgewählt" />
      ) : (
        <ul aria-label="Dateien" className="divide-y">
          {rows.map((row) => {
            const StatusIcon =
              row.status === 'done' ? CheckCircle : row.status === 'error' ? XCircle : FileText;

            return (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                {row.status === 'uploading' ? (
                  <Spinner className="shrink-0" />
                ) : (
                  <StatusIcon
                    className={
                      row.status === 'error' ? 'size-4 shrink-0 text-destructive' : 'size-4 shrink-0'
                    }
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.file.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.relativePath ? `${row.relativePath} · ` : ''}
                    {formatFileSize(row.file.size)}
                    {row.category ? ` · ${DOCUMENT_CATEGORY_LABELS[row.category]}` : ''}
                    {row.status === 'uploading' && row.progress !== undefined
                      ? ` · ${Math.round(row.progress * 100)} %`
                      : ''}
                    {row.status === 'done' ? ' · Gespeichert' : ''}
                  </p>
                  <ErrorText className="mt-0.5 text-xs">
                    {row.status === 'error' && row.failure ? FAILURE_TEXT[row.failure] : null}
                  </ErrorText>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function summarizeUploadProgress(rows: DocumentUploadRow[]) {
  const completedCount = rows.filter((row) => row.status === 'done' || row.status === 'error').length;
  const totalProgress = rows.reduce(
    (sum, row) =>
      sum +
      (row.status === 'done' || row.status === 'error'
        ? 1
        : row.status === 'uploading'
          ? (row.progress ?? 0)
          : 0),
    0,
  );
  const progressPercentage = rows.length ? Math.round((totalProgress / rows.length) * 100) : 0;
  return { completedCount, progressPercentage };
}

/** Asks the browser to confirm leaving the page while files are still on their way. */
export function useLeavePageWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

export function DocumentUploadFooter({
  isRunning,
  confirmingCancel,
  canRetry,
  onConfirmCancel,
  onKeepUploading,
  onCancel,
  onRetry,
  onClose,
}: {
  isRunning: boolean;
  confirmingCancel: boolean;
  canRetry: boolean;
  onConfirmCancel: () => void;
  onKeepUploading: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}): ReactElement {
  const keepUploadingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingCancel) keepUploadingRef.current?.focus();
  }, [confirmingCancel]);

  if (isRunning && confirmingCancel) {
    return (
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Trotzdem abbrechen
        </Button>
        <Button ref={keepUploadingRef} type="button" onClick={onKeepUploading}>
          Weiter hochladen
        </Button>
      </DialogFooter>
    );
  }
  if (isRunning) {
    return (
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onConfirmCancel}>
          Abbrechen
        </Button>
      </DialogFooter>
    );
  }
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose}>
        Schließen
      </Button>
      {canRetry && (
        <Button type="button" onClick={onRetry}>
          Erneut versuchen
        </Button>
      )}
    </DialogFooter>
  );
}
