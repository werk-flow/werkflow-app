'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { CheckCircle, FileText, Loader2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createDocumentFolder, uploadDocument } from '@/lib/documents/actions';
import {
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  type DocumentCategory,
} from '@/lib/documents/types';

export type DocumentUploadItem = {
  id: string;
  file: File;
  relativePath?: string;
  category?: DocumentCategory;
};

type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

type UploadRow = DocumentUploadItem & {
  status: UploadStatus;
  error?: string;
};

type UploadTarget = {
  folderId?: string | null;
  jobId?: string;
  projectId?: string;
  clientId?: string;
  employeeId?: string;
};

type DocumentUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  items: DocumentUploadItem[];
  target: UploadTarget;
  allowFolderCreation?: boolean;
  onComplete: (failedCount: number) => void;
};

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFolderSegments(relativePath?: string): string[] {
  if (!relativePath) return [];
  const parts = relativePath.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1) : [];
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  title = 'Dateien hochladen',
  description = 'Die Dateien werden automatisch hochgeladen.',
  items,
  target,
  allowFolderCreation = false,
  onComplete,
}: DocumentUploadDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [hasStarted, setHasStarted] = useState(false);

  const activeRows: UploadRow[] =
    rows.length > 0
      ? rows
      : items.map((item) => ({
          ...item,
          status: 'queued' as const,
        }));
  const completedCount = activeRows.filter(
    (row) => row.status === 'done' || row.status === 'error'
  ).length;
  const progressPercentage = activeRows.length
    ? Math.round((completedCount / activeRows.length) * 100)
    : 0;
  const isComplete = hasStarted && completedCount === activeRows.length;

  const oversizedCount = useMemo(
    () => items.filter((item) => item.file.size > DOCUMENT_MAX_FILE_SIZE_BYTES).length,
    [items]
  );

  async function ensureRelativeFolder(
    folderCache: Map<string, string | null>,
    relativePath?: string
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

  function updateRow(id: string, update: Partial<UploadRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...update } : row))
    );
  }

  function handleStartUpload() {
    const initialRows: UploadRow[] = items.map((item) => ({
      ...item,
      status: item.file.size > DOCUMENT_MAX_FILE_SIZE_BYTES ? 'error' : 'queued',
      error: item.file.size > DOCUMENT_MAX_FILE_SIZE_BYTES ? 'Datei ist größer als 50 MB.' : undefined,
    }));

    setRows(initialRows);
    setHasStarted(true);

    startTransition(async () => {
      let failures = initialRows.filter((row) => row.status === 'error').length;
      const folderCache = new Map<string, string | null>();

      for (const row of initialRows) {
        if (row.status === 'error') continue;

        updateRow(row.id, { status: 'uploading' });

        try {
          const folderId = await ensureRelativeFolder(folderCache, row.relativePath);
          const formData = new FormData();
          formData.append('file', row.file);
          if (folderId) formData.append('folderId', folderId);
          if (target.jobId) formData.append('jobId', target.jobId);
          if (target.projectId) formData.append('projectId', target.projectId);
          if (target.clientId) formData.append('clientId', target.clientId);
          if (target.employeeId) formData.append('employeeId', target.employeeId);
          if (row.category) formData.append('category', row.category);

          const result = await uploadDocument(formData);
          if (!result.success) {
            failures++;
            updateRow(row.id, {
              status: 'error',
              error: 'Upload fehlgeschlagen.',
            });
            continue;
          }

          updateRow(row.id, { status: 'done' });
        } catch {
          failures++;
          updateRow(row.id, {
            status: 'error',
            error: 'Upload fehlgeschlagen.',
          });
        }
      }

      onComplete(failures);
      if (failures === 0) {
        window.setTimeout(() => {
          handleOpenChange(false);
        }, 650);
      }
    });
  }

  useEffect(() => {
    if (!open || hasStarted || isPending || items.length === 0) return;
    handleStartUpload();
    // handleStartUpload intentionally owns the mutable upload queue for this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasStarted, isPending, items.length]);

  function handleOpenChange(nextOpen: boolean) {
    if (isPending && !isComplete) return;
    if (!nextOpen) {
      setRows([]);
      setHasStarted(false);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {completedCount} von {activeRows.length} abgeschlossen
              </span>
              <span>{progressPercentage}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {oversizedCount > 0 && !hasStarted && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {oversizedCount} Datei(en) sind größer als 50 MB und werden nicht
              hochgeladen.
            </p>
          )}

          <div className="max-h-80 overflow-auto rounded-md border">
            {activeRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Keine Dateien ausgewählt.
              </div>
            ) : (
              <div className="divide-y">
                {activeRows.map((row) => {
                  const StatusIcon =
                    row.status === 'done'
                      ? CheckCircle
                      : row.status === 'error'
                        ? XCircle
                        : row.status === 'uploading'
                          ? Loader2
                          : FileText;

                  return (
                    <div key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                      <StatusIcon
                        className={`size-4 shrink-0 ${
                          row.status === 'uploading' ? 'animate-spin' : ''
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.file.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.relativePath ? `${row.relativePath} · ` : ''}
                          {formatFileSize(row.file.size)}
                          {row.category
                            ? ` · ${DOCUMENT_CATEGORY_LABELS[row.category]}`
                            : ''}
                        </p>
                        {row.error && (
                          <p className="mt-0.5 text-xs text-destructive">{row.error}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending && !isComplete}
          >
            {isComplete ? 'Schließen' : 'Abbrechen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
