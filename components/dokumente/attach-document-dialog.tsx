'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { formatFileSize } from '@/lib/documents/format';
import { useEffect, useState } from 'react';
import { Check, FileText, LinkIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { SearchInput } from '@/components/ui/search-input';
import { getAttachableDocuments, linkDocumentsToTarget } from '@/lib/documents/actions';
import type { OrganizationDocument } from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import { useServerAction } from '@/hooks/use-server-action';

type AttachDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType:
    | 'job'
    | 'project'
    | 'client'
    | 'employee'
    | 'equipment'
    | 'service_case'
    | 'maintenance_coverage';
  targetId: string;
  targetLabel?: string | undefined;
  onAttached: (variant: 'success' | 'error', message: string) => void;
};

const TARGET_TYPE_LABELS: Record<AttachDocumentDialogProps['targetType'], string> = {
  job: 'Auftrag',
  project: 'Projekt',
  client: 'Kunde',
  employee: 'Mitarbeiter',
  equipment: 'Anlage',
  service_case: 'Servicefall',
  maintenance_coverage: 'die operative Abdeckung',
};

export function AttachDocumentDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetLabel,
  onAttached,
}: AttachDocumentDialogProps) {
  const { run: runLinkDocuments, isPending } = useServerAction(linkDocumentsToTarget);
  const [searchQuery, setSearchQuery] = useState('');
  const [documents, setDocuments] = useState<OrganizationDocument[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  // Both failures render inside the dialog (feedback canon: the error sits at
  // the point of action and the dialog never closes on failure).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearchQuery('');
      setSelectedDocumentIds(new Set());
      setAttachError(null);
    }
    onOpenChange(nextOpen);
  }

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await getAttachableDocuments({
          targetType,
          targetId,
          searchQuery,
          category: 'all',
        });
        if (cancelled) return;

        if (result.success) {
          setDocuments(result.documents);
          setHasMore(result.hasMore ?? false);
          setLoadError(null);
          return;
        }
        setDocuments([]);
        setLoadError('Dokumente konnten nicht geladen werden.');
      } catch {
        if (cancelled) return;
        setDocuments([]);
        setLoadError('Dokumente konnten nicht geladen werden.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, searchQuery, targetId, targetType, reloadCount]);

  function toggleDocument(documentId: string) {
    setAttachError(null);
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function handleAttach() {
    if (selectedDocumentIds.size === 0) {
      setAttachError('Bitte wähle mindestens ein Dokument aus.');
      return;
    }
    setAttachError(null);

    void (async () => {
      const documentIds = [...selectedDocumentIds];
      let result: Awaited<ReturnType<typeof linkDocumentsToTarget>>;
      try {
        result = await runLinkDocuments({
          documentIds,
          ...(targetType === 'job' ? { jobId: targetId } : {}),
          ...(targetType === 'project' ? { projectId: targetId } : {}),
          ...(targetType === 'client' ? { clientId: targetId } : {}),
          ...(targetType === 'employee' ? { employeeId: targetId } : {}),
          ...(targetType === 'equipment' ? { equipmentId: targetId } : {}),
          ...(targetType === 'service_case' ? { serviceCaseId: targetId } : {}),
          ...(targetType === 'maintenance_coverage' ? { maintenanceCoverageId: targetId } : {}),
        });
      } catch {
        setAttachError('Die Dokumente konnten nicht verknüpft werden.');
        return;
      }

      if (result.success) {
        onAttached(
          'success',
          result.linkedCount === 1
            ? 'Dokument wurde verknüpft.'
            : `${result.linkedCount} Dokumente wurden verknüpft.`,
        );
        handleDialogOpenChange(false);
        return;
      }

      // Partial success stays open too: the linked documents are persisted
      // and reach the page through the Realtime refresh; the failed ones stay
      // selected so the user can retry or cancel.
      setAttachError(
        result.linkedCount > 0
          ? `${result.linkedCount} Dokument(e) verknüpft, ${result.failedCount} fehlgeschlagen.`
          : 'Die Dokumente konnten nicht verknüpft werden.',
      );
    })();
  }

  const targetTypeLabel = TARGET_TYPE_LABELS[targetType];

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange} pending={isPending}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Vorhandenes Dokument verknüpfen</DialogTitle>
          <DialogDescription>
            Wähle ein oder mehrere Dokumente aus der Dokumentenablage
            {targetLabel ? ` für ${targetTypeLabel} „${targetLabel}“` : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <SearchInput
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder="Dokument suchen…"
            aria-label="Dokument suchen"
          />

          <div className="max-h-80 overflow-auto rounded-md border">
            {loadError ? (
              <SectionError className="m-3" onRetry={() => setReloadCount((count) => count + 1)}>
                {loadError}
              </SectionError>
            ) : documents.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Keine verknüpfbaren Dokumente gefunden.
              </div>
            ) : (
              <div className="divide-y">
                {documents.map((document) => {
                  const isSelected = selectedDocumentIds.has(document.id);

                  return (
                    <PlainButton
                      key={document.id}
                      type="button"
                      onClick={() => toggleDocument(document.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                        isSelected && 'bg-accent',
                      )}
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{document.displayName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatFileSize(document.sizeBytes)}
                          {document.links.length > 0 ? ` · ${document.links.length} Verknüpfung(en)` : ''}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </PlainButton>
                  );
                })}
              </div>
            )}
          </div>
          {/* Below the scroll box, like the material picker's hint, so it is visible without scrolling. */}
          {hasMore && !loadError && documents.length > 0 && (
            <p className="text-xs text-muted-foreground" role="status">
              Es werden die 50 neuesten Dokumente angezeigt. Suche nach dem Namen, um weitere zu finden.
            </p>
          )}

          <ErrorText>{attachError}</ErrorText>
        </div>

        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">{selectedDocumentIds.size} ausgewählt</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleDialogOpenChange(false)}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button pending={isPending} type="button" onClick={handleAttach} disabled={isPending}>
            <LinkIcon className="size-4" />
            Verknüpfen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
