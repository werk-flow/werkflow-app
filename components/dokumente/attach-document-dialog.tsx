'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { formatFileSize } from '@/lib/documents/format';
import { useState } from 'react';
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
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { SearchInput } from '@/components/ui/search-input';
import { readInBackground } from '@/lib/data/background-read-client';
import { linkDocumentsToTarget } from '@/lib/documents/actions';
import type { OrganizationDocument } from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import { useClientRead } from '@/hooks/use-client-read';
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

type AttachTargetType = AttachDocumentDialogProps['targetType'];

function linkTargetInput(targetType: AttachTargetType, targetId: string) {
  return {
    ...(targetType === 'job' ? { jobId: targetId } : {}),
    ...(targetType === 'project' ? { projectId: targetId } : {}),
    ...(targetType === 'client' ? { clientId: targetId } : {}),
    ...(targetType === 'employee' ? { employeeId: targetId } : {}),
    ...(targetType === 'equipment' ? { equipmentId: targetId } : {}),
    ...(targetType === 'service_case' ? { serviceCaseId: targetId } : {}),
    ...(targetType === 'maintenance_coverage' ? { maintenanceCoverageId: targetId } : {}),
  };
}

function attachedMessage(linkedCount: number) {
  return linkedCount === 1 ? 'Dokument wurde verknüpft.' : `${linkedCount} Dokumente wurden verknüpft.`;
}

function attachFailureMessage(linkedCount: number, failedCount: number) {
  return linkedCount > 0
    ? `${linkedCount} Dokument(e) verknüpft, ${failedCount} fehlgeschlagen.`
    : 'Die Dokumente konnten nicht verknüpft werden.';
}

type AttachableDocumentsInput = {
  open: boolean;
  targetType: AttachTargetType;
  targetId: string;
  searchQuery: string;
};

function useAttachableDocuments({ open, targetType, targetId, searchQuery }: AttachableDocumentsInput) {
  // The previous results stay listed while the next search runs.
  return useClientRead({
    read: (signal) =>
      readInBackground(
        'attachable-documents',
        { targetType, targetId, searchQuery, category: 'all' },
        signal,
      ),
    deps: [searchQuery, targetId, targetType],
    enabled: open,
    failureMessage: 'Dokumente konnten nicht geladen werden.',
    keepPreviousData: true,
  });
}

type AttachDocumentDialogStateInput = Omit<AttachDocumentDialogProps, 'targetLabel'>;

function useAttachDocumentDialogState({
  open,
  onOpenChange,
  targetType,
  targetId,
  onAttached,
}: AttachDocumentDialogStateInput) {
  const { run: runLinkDocuments, isPending } = useServerAction(linkDocumentsToTarget);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  // Both failures render inside the dialog (feedback canon: the error sits at
  // the point of action and the dialog never closes on failure).
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachable = useAttachableDocuments({ open, targetType, targetId, searchQuery });
  const documents: OrganizationDocument[] = attachable.data?.documents ?? [];
  const hasMore = attachable.data?.hasMore ?? false;
  const listFailure = attachable.failure;

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearchQuery('');
      setSelectedDocumentIds(new Set());
      setAttachError(null);
    }
    onOpenChange(nextOpen);
  }

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
          ...linkTargetInput(targetType, targetId),
        });
      } catch {
        setAttachError('Die Dokumente konnten nicht verknüpft werden.');
        return;
      }

      if (result.success) {
        onAttached('success', attachedMessage(result.linkedCount));
        handleDialogOpenChange(false);
        return;
      }

      // Partial success stays open too: the linked documents are persisted
      // and reach the page through the Realtime refresh; the failed ones stay
      // selected so the user can retry or cancel.
      setAttachError(attachFailureMessage(result.linkedCount, result.failedCount));
    })();
  }

  return {
    isPending,
    searchQuery,
    setSearchQuery,
    selectedDocumentIds,
    attachError,
    documents,
    hasMore,
    listFailure,
    handleDialogOpenChange,
    toggleDocument,
    handleAttach,
  };
}

type AttachableDocumentRowsProps = {
  documents: OrganizationDocument[];
  selectedDocumentIds: Set<string>;
  onToggle: (documentId: string) => void;
};

function AttachableDocumentRows({ documents, selectedDocumentIds, onToggle }: AttachableDocumentRowsProps) {
  return (
    <div className="divide-y">
      {documents.map((document) => {
        const isSelected = selectedDocumentIds.has(document.id);

        return (
          <PlainButton
            key={document.id}
            type="button"
            onClick={() => onToggle(document.id)}
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
  );
}

export function AttachDocumentDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetLabel,
  onAttached,
}: AttachDocumentDialogProps) {
  const dialog = useAttachDocumentDialogState({ open, onOpenChange, targetType, targetId, onAttached });

  const targetTypeLabel = TARGET_TYPE_LABELS[targetType];

  return (
    <Dialog open={open} onOpenChange={dialog.handleDialogOpenChange} pending={dialog.isPending}>
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
            value={dialog.searchQuery}
            onValueChange={dialog.setSearchQuery}
            placeholder="Dokument suchen…"
            aria-label="Dokument suchen"
          />

          <div className="max-h-80 overflow-y-auto rounded-md border">
            {dialog.listFailure ? (
              <SectionError className="m-3" failure={dialog.listFailure} />
            ) : dialog.documents.length === 0 ? (
              <EmptyState title="Keine verknüpfbaren Dokumente gefunden" />
            ) : (
              <AttachableDocumentRows
                documents={dialog.documents}
                selectedDocumentIds={dialog.selectedDocumentIds}
                onToggle={dialog.toggleDocument}
              />
            )}
          </div>
          {/* Below the scroll box, like the material picker's hint, so it is visible without scrolling. */}
          {dialog.hasMore && !dialog.listFailure && dialog.documents.length > 0 && (
            <p className="text-xs text-muted-foreground" role="status">
              Es werden die 50 neuesten Dokumente angezeigt. Suche nach dem Namen, um weitere zu finden.
            </p>
          )}

          <ErrorText>{dialog.attachError}</ErrorText>
        </div>

        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">
            {dialog.selectedDocumentIds.size} ausgewählt
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => dialog.handleDialogOpenChange(false)}
            disabled={dialog.isPending}
          >
            Abbrechen
          </Button>
          <Button
            pending={dialog.isPending}
            type="button"
            onClick={dialog.handleAttach}
            disabled={dialog.isPending}
          >
            <LinkIcon className="size-4" />
            Verknüpfen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
