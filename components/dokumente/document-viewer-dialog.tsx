'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Download,
  ExternalLink,
  FileText,
  Info,
  Maximize2,
  Minimize2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getDocumentSignedUrl,
  getDocumentViewSignedUrl,
} from '@/lib/documents/actions';
import type { OrganizationDocument } from '@/lib/documents/types';
import { cn } from '@/lib/utils';

type DocumentViewerDialogProps = {
  document: OrganizationDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function canPreviewImage(document: OrganizationDocument): boolean {
  return Boolean(document.mimeType?.startsWith('image/'));
}

function canPreviewPdf(document: OrganizationDocument): boolean {
  return (
    document.mimeType === 'application/pdf' ||
    document.displayName.toLowerCase().endsWith('.pdf')
  );
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

function getPdfPreviewUrl(signedUrl: string): string {
  return `${signedUrl}#toolbar=0&navpanes=0&view=FitH`;
}

export function DocumentViewerDialog({
  document,
  open,
  onOpenChange,
}: DocumentViewerDialogProps) {
  const [preview, setPreview] = useState<{
    documentId: string;
    signedUrl: string | null;
    error: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!open || !document) {
      return;
    }

    let cancelled = false;

    getDocumentViewSignedUrl(document.id).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setPreview({
          documentId: document.id,
          signedUrl: null,
          error: 'Die Vorschau konnte nicht geladen werden.',
        });
        return;
      }
      setPreview({
        documentId: document.id,
        signedUrl: result.signedUrl,
        error: null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [document, open]);

  function handleDownload() {
    if (!document) return;

    startTransition(async () => {
      const result = await getDocumentSignedUrl(document.id);
      if (!result.success) {
        setPreview({
          documentId: document.id,
          signedUrl: null,
          error: 'Der Download konnte nicht vorbereitet werden.',
        });
        return;
      }
      window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
    });
  }

  const supportsPreview = document
    ? canPreviewImage(document) || canPreviewPdf(document)
    : false;
  const activePreview =
    document && preview?.documentId === document.id ? preview : null;
  const signedUrl = activePreview?.signedUrl ?? null;
  const error = activePreview?.error ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex !h-[96vh] !max-h-[96vh] !w-[min(1680px,96vw)] !max-w-none flex-col gap-0 overflow-hidden border-border/70 bg-neutral-950 p-0 text-white shadow-2xl sm:!max-w-none',
          isExpanded &&
            '!h-screen !max-h-screen !w-screen rounded-none border-0 sm:!max-w-none'
        )}
      >
        <DialogHeader className="border-b border-white/10 bg-neutral-950/95 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <DialogTitle className="truncate text-white">
                {document?.displayName ?? 'Dokument'}
              </DialogTitle>
              <DialogDescription className="truncate text-white/60">
                {document
                  ? `${formatFileSize(document.sizeBytes)} · geändert ${formatDate(document.updatedAt)}`
                  : 'Vorschau für PDFs und Bilder.'}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                onClick={() => setIsExpanded((current) => !current)}
              >
                {isExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
                {isExpanded ? 'Kompakt' : 'Vollbild'}
              </Button>
              {signedUrl && supportsPreview && (
                <Button type="button" variant="outline" size="sm" asChild>
                  <a
                    href={signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  >
                    <ExternalLink className="size-4" />
                    Neuer Tab
                  </a>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleDownload}
                disabled={isPending}
              >
                <Download className="size-4" />
                Herunterladen
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 bg-neutral-950 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-h-0 overflow-hidden bg-neutral-900">
            {!document ? null : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FileText className="size-10 text-white/50" />
              <p className="text-sm text-white/70">{error}</p>
            </div>
          ) : !signedUrl ? (
            <div className="flex h-full items-center justify-center text-sm text-white/60">
              Vorschau wird geladen...
            </div>
          ) : canPreviewImage(document) ? (
            <div className="flex h-full items-center justify-center overflow-auto p-6">
              {/* Signed private Storage URLs are short-lived, so next/image optimization is not useful here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signedUrl}
                alt={document.displayName}
                className="max-h-full max-w-full object-contain shadow-2xl"
              />
            </div>
          ) : canPreviewPdf(document) ? (
            <iframe
              src={getPdfPreviewUrl(signedUrl)}
              title={document.displayName}
              className="h-full w-full bg-neutral-800"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <FileText className="size-10 text-white/50" />
                <p className="max-w-md text-sm text-white/70">
                  Für diesen Dateityp gibt es noch keine direkte Vorschau.
                </p>
            </div>
          )}
          </div>

          {document && (
            <aside className="hidden border-l border-white/10 bg-neutral-950 p-4 text-sm text-white/80 xl:block">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/50">
                <Info className="size-3.5" />
                Dateiinformationen
              </p>
              <dl className="mt-3 space-y-3">
                <div>
                  <dt className="text-white/50">Originaldatei</dt>
                  <dd className="mt-0.5 break-words font-medium">
                    {document.originalFileName}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/50">Dateigröße</dt>
                  <dd className="mt-0.5">{formatFileSize(document.sizeBytes)}</dd>
                </div>
                <div>
                  <dt className="text-white/50">Hochgeladen</dt>
                  <dd className="mt-0.5">{formatDate(document.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-white/50">Geändert</dt>
                  <dd className="mt-0.5">{formatDate(document.updatedAt)}</dd>
                </div>
              </dl>
            </aside>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
