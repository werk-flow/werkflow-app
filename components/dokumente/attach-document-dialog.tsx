'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, FileText, LinkIcon, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  getAttachableDocuments,
  linkDocumentsToTarget,
} from '@/lib/documents/actions';
import type { OrganizationDocument } from '@/lib/documents/types';
import { cn } from '@/lib/utils';

type AttachDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'job' | 'project' | 'client' | 'employee';
  targetId: string;
  targetLabel?: string;
  onAttached: (variant: 'success' | 'error', message: string) => void;
};

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachDocumentDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetLabel,
  onAttached,
}: AttachDocumentDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState('');
  const [documents, setDocuments] = useState<OrganizationDocument[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearchQuery('');
      setSelectedDocumentIds(new Set());
    }
    onOpenChange(nextOpen);
  }

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    startTransition(async () => {
      const result = await getAttachableDocuments({
        targetType,
        targetId,
        searchQuery,
        category: 'all',
      });

      if (cancelled) return;

      if (result.success) {
        setDocuments(result.documents);
        return;
      }

      setDocuments([]);
      onAttached('error', 'Dokumente konnten nicht geladen werden.');
    });

    return () => {
      cancelled = true;
    };
  }, [open, onAttached, searchQuery, targetId, targetType]);

  function toggleDocument(documentId: string) {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function handleAttach() {
    if (selectedDocumentIds.size === 0) return;

    startTransition(async () => {
      const documentIds = [...selectedDocumentIds];
      const result = await linkDocumentsToTarget({
        documentIds,
        jobId: targetType === 'job' ? targetId : undefined,
        projectId: targetType === 'project' ? targetId : undefined,
        clientId: targetType === 'client' ? targetId : undefined,
        employeeId: targetType === 'employee' ? targetId : undefined,
      });

      if (result.success) {
        onAttached(
          'success',
          result.linkedCount === 1
            ? 'Dokument wurde verknüpft.'
            : `${result.linkedCount} Dokumente wurden verknüpft.`
        );
        handleDialogOpenChange(false);
        return;
      }

      if (result.linkedCount > 0) {
        onAttached(
          'error',
          `${result.linkedCount} Dokument(e) verknüpft, ${result.failedCount} fehlgeschlagen.`
        );
        handleDialogOpenChange(false);
        return;
      }

      onAttached('error', 'Die Dokumente konnten nicht verknüpft werden.');
    });
  }

  const targetTypeLabel =
    targetType === 'job'
      ? 'Auftrag'
      : targetType === 'project'
        ? 'Projekt'
        : targetType === 'client'
          ? 'Kunde'
          : 'Mitarbeiter';

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vorhandenes Dokument verknüpfen</DialogTitle>
          <DialogDescription>
            Wähle ein oder mehrere Dokumente aus der Dokumentenablage
            {targetLabel ? ` für ${targetTypeLabel} „${targetLabel}“` : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex items-center gap-2 rounded-md border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Dokument suchen..."
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="max-h-80 overflow-auto rounded-md border">
            {documents.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Keine verknüpfbaren Dokumente gefunden.
              </div>
            ) : (
              <div className="divide-y">
                {documents.map((document) => {
                  const isSelected = selectedDocumentIds.has(document.id);

                  return (
                    <button
                      key={document.id}
                      type="button"
                      onClick={() => toggleDocument(document.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                        isSelected && 'bg-accent'
                      )}
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {document.displayName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatFileSize(document.sizeBytes)}
                          {document.links.length > 0
                            ? ` · ${document.links.length} Verknüpfung(en)`
                            : ''}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">
            {selectedDocumentIds.size} ausgewählt
          </p>
          <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={handleAttach}
            disabled={isPending || selectedDocumentIds.size === 0}
          >
            <LinkIcon className="size-4" />
            Verknüpfen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
