'use client';

import { useRef, useState, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Download,
  FileText,
  LinkIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  deleteDocument,
  renameDocument as renameDocumentAction,
  unlinkDocument,
} from '@/lib/documents/actions';
import {
  DOCUMENT_CATEGORY_LABELS,
  type OrganizationDocument,
  type ProjectJobDocumentGroup,
} from '@/lib/documents/types';
import {
  FeedbackBanner,
  type FeedbackBannerMessage,
} from '@/components/shared/feedback-banner';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { cn } from '@/lib/utils';
import { AttachDocumentDialog } from './attach-document-dialog';
import { DocumentLinkDialog } from './document-link-dialog';
import {
  DocumentUploadDialog,
  type DocumentUploadItem,
} from './document-upload-dialog';
import { DocumentViewerDialog } from './document-viewer-dialog';

type ContextualDocumentsSectionProps = {
  title: string;
  description: string;
  documents: OrganizationDocument[];
  jobDocumentGroups?: ProjectJobDocumentGroup[];
  jobId?: string;
  projectId?: string;
  clientId?: string;
  employeeId?: string;
  contextLabel?: string;
  canUpload: boolean;
  canManage: boolean;
};

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
  }).format(new Date(date));
}

function getContextLink(
  document: OrganizationDocument,
  context: { jobId?: string; projectId?: string; clientId?: string; employeeId?: string }
) {
  return document.links.find((link) => {
    if (context.jobId) return link.jobId === context.jobId;
    if (context.projectId) return link.projectId === context.projectId;
    if (context.clientId) return link.clientId === context.clientId;
    if (context.employeeId) return link.employeeId === context.employeeId;
    return false;
  });
}

function getDeleteDescription(document: OrganizationDocument): string {
  const linkCount = document.links.length;

  if (linkCount <= 1) {
    return `„${document.displayName}“ wird aus der gesamten Dokumentenablage in den Papierkorb verschoben. Die Datei ist danach überall nicht mehr verfügbar.`;
  }

  return `„${document.displayName}“ ist mit ${linkCount} Aufträgen, Projekten, Kunden oder Mitarbeitern verknüpft. Das Löschen entfernt die Datei überall aus WerkFlow und verschiebt sie in den Papierkorb – nicht nur auf dieser Seite.`;
}

function getUnlinkLabel(context: {
  jobId?: string;
  projectId?: string;
  clientId?: string;
  employeeId?: string;
}): string {
  if (context.jobId) return 'Verknüpfung zu diesem Auftrag entfernen';
  if (context.projectId) return 'Verknüpfung zu diesem Projekt entfernen';
  if (context.clientId) return 'Verknüpfung zu diesem Kunden entfernen';
  if (context.employeeId) return 'Verknüpfung zu diesem Mitarbeiter entfernen';
  return 'Verknüpfung entfernen';
}

type DocumentRowProps = {
  document: OrganizationDocument;
  isPending: boolean;
  canManage: boolean;
  context: { jobId?: string; projectId?: string; clientId?: string; employeeId?: string };
  indented?: boolean;
  onOpen: (document: OrganizationDocument) => void;
  onManageLinks: (document: OrganizationDocument) => void;
  onRename: (document: OrganizationDocument) => void;
  onUnlink: (document: OrganizationDocument) => void;
  onDelete: (document: OrganizationDocument) => void;
};

function DocumentRow({
  document,
  isPending,
  canManage,
  context,
  indented = false,
  onOpen,
  onManageLinks,
  onRename,
  onUnlink,
  onDelete,
}: DocumentRowProps) {
  const contextLink = getContextLink(document, context);
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 px-3 py-2.5',
        indented && 'pl-8'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(document)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{document.displayName}</span>
        </span>
        <span className="ml-6 mt-0.5 block text-xs text-muted-foreground">
          {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)} ·{' '}
          {formatDate(document.updatedAt)}
          {document.links.length > 1
            ? ` · ${document.links.length} Verknüpfungen`
            : ''}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={isPending} className="shrink-0">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Dateiaktionen öffnen</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onOpen(document)}>
            <Download className="size-4" />
            Öffnen
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuItem onClick={() => onManageLinks(document)}>
                <LinkIcon className="size-4" />
                Verknüpfungen verwalten
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRename(document)}>
                <Pencil className="size-4" />
                Umbenennen
              </DropdownMenuItem>
              {contextLink && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onUnlink(document)}>
                    <Unlink className="size-4" />
                    {getUnlinkLabel(context)}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(document)}>
                <Trash2 className="size-4" />
                In Papierkorb verschieben
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ContextualDocumentsSection({
  title,
  description,
  documents,
  jobDocumentGroups = [],
  jobId,
  projectId,
  clientId,
  employeeId,
  contextLabel,
  canUpload,
  canManage,
}: ContextualDocumentsSectionProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackIdRef = useRef(0);
  const uploadItemIdRef = useRef(0);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackBannerMessage | null>(null);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [linkDialogDocument, setLinkDialogDocument] = useState<OrganizationDocument | null>(
    null
  );
  const [expandedJobGroups, setExpandedJobGroups] = useState<Set<string>>(new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<DocumentUploadItem[]>([]);
  const [viewerDocument, setViewerDocument] = useState<OrganizationDocument | null>(null);
  const [renameDocument, setRenameDocument] = useState<OrganizationDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteDocumentTarget, setDeleteDocumentTarget] =
    useState<OrganizationDocument | null>(null);

  const context = { jobId, projectId, clientId, employeeId };
  const totalDocumentCount =
    documents.length +
    jobDocumentGroups.reduce((total, group) => total + group.documents.length, 0);

  useRealtimeRouterRefresh({
    tables: ['documents', 'document_links', 'document_audit_events', 'document_versions'],
    debounceMs: 250,
  });

  function showFeedback(variant: 'success' | 'error', message: string) {
    feedbackIdRef.current += 1;
    setFeedback({ id: feedbackIdRef.current, variant, message });
  }

  function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploadItems(
      Array.from(files).map((file) => {
        uploadItemIdRef.current += 1;
        return {
          id: `context-upload-${uploadItemIdRef.current}`,
          file,
        };
      })
    );
    setUploadDialogOpen(true);
  }

  function handleRenameConfirm() {
    if (!renameDocument) return;
    const nextName = renameValue.trim();
    if (!nextName || nextName === renameDocument.displayName) {
      setRenameDocument(null);
      return;
    }

    startTransition(async () => {
      const result = await renameDocumentAction({
        documentId: renameDocument.id,
        displayName: nextName,
      });
      if (!result.success) {
        showFeedback('error', 'Die Datei konnte nicht umbenannt werden.');
      }
      setRenameDocument(null);
      router.refresh();
    });
  }

  function handleUnlink(document: OrganizationDocument) {
    const link = getContextLink(document, context);
    if (!link) return;

    startTransition(async () => {
      const result = await unlinkDocument({ linkId: link.id });
      if (!result.success) {
        showFeedback('error', 'Die Verknüpfung konnte nicht entfernt werden.');
        return;
      }
      showFeedback('success', 'Verknüpfung wurde entfernt. Die Datei bleibt in der Dokumentenablage.');
      router.refresh();
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    if (!canUpload) return;
    handleUpload(event.dataTransfer.files);
  }

  function toggleJobGroup(jobIdToToggle: string) {
    setExpandedJobGroups((current) => {
      const next = new Set(current);
      if (next.has(jobIdToToggle)) next.delete(jobIdToToggle);
      else next.add(jobIdToToggle);
      return next;
    });
  }

  const rowProps = {
    isPending,
    canManage,
    context,
    onOpen: setViewerDocument,
    onManageLinks: setLinkDialogDocument,
    onRename: (document: OrganizationDocument) => {
      setRenameDocument(document);
      setRenameValue(document.displayName);
    },
    onUnlink: handleUnlink,
    onDelete: setDeleteDocumentTarget,
  };

  function renderFlatList(documentList: OrganizationDocument[]) {
    return (
      <div className="min-w-0 overflow-hidden rounded-md border">
        {documentList.map((document) => (
          <DocumentRow key={document.id} document={document} {...rowProps} />
        ))}
      </div>
    );
  }

  function renderGroupedProjectView() {
    return (
      <div className="space-y-3">
        {documents.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Projektdateien
            </p>
            {renderFlatList(documents)}
          </div>
        )}

        {jobDocumentGroups.map((group) => {
          const isExpanded = expandedJobGroups.has(group.jobId);
          const jobLabel = group.jobNumber
            ? `${group.jobNumber} · ${group.jobTitle}`
            : group.jobTitle;

          return (
            <div key={group.jobId} className="rounded-md border">
              <button
                type="button"
                onClick={() => toggleJobGroup(group.jobId)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
              >
                <ChevronRight
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    isExpanded && 'rotate-90'
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{jobLabel}</span>
                  <span className="block text-xs text-muted-foreground">
                    {group.documents.length}{' '}
                    {group.documents.length === 1 ? 'Datei' : 'Dateien'}
                  </span>
                </span>
              </button>
              {isExpanded && (
                <div className="divide-y border-t">
                  {group.documents.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      indented
                      {...rowProps}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border bg-card p-4 transition-colors sm:p-5',
        isDragActive && 'border-primary bg-primary/5'
      )}
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
    >
      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="size-4" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>

        {canUpload && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {canManage && (jobId || projectId || clientId || employeeId) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAttachDialogOpen(true)}
                disabled={isPending}
              >
                <LinkIcon className="size-4" />
                Verknüpfen
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPending}
            >
              <Upload className="size-4" />
              Hochladen
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => handleUpload(event.target.files)}
            />
          </div>
        )}
      </div>

      {totalDocumentCount === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-medium">Noch keine Dokumente vorhanden.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canUpload
              ? 'Lade Dateien hoch oder verknüpfe vorhandene Dokumente aus der Dokumentenablage.'
              : 'Sobald Dokumente vorhanden sind, erscheinen sie hier.'}
          </p>
        </div>
      ) : projectId ? (
        renderGroupedProjectView()
      ) : (
        renderFlatList(documents)
      )}

      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        items={uploadItems}
        target={{ jobId, projectId, clientId, employeeId }}
        onComplete={(failedCount) => {
          if (failedCount > 0) {
            showFeedback(
              'error',
              `${failedCount} Datei(en) konnten nicht hochgeladen werden.`
            );
          }
          if (fileInputRef.current) fileInputRef.current.value = '';
          router.refresh();
        }}
      />

      <DocumentViewerDialog
        document={viewerDocument}
        open={!!viewerDocument}
        onOpenChange={(open) => !open && setViewerDocument(null)}
      />

      <DocumentLinkDialog
        key={linkDialogDocument?.id ?? 'closed-context-link-dialog'}
        document={linkDialogDocument}
        open={!!linkDialogDocument}
        onOpenChange={(open) => !open && setLinkDialogDocument(null)}
        onComplete={(variant, message) => {
          showFeedback(variant, message);
          router.refresh();
        }}
      />

      <Dialog
        open={!!renameDocument}
        onOpenChange={(open) => !open && setRenameDocument(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Datei umbenennen</DialogTitle>
            <DialogDescription>
              Vergib einen klaren Namen, damit das Dokument später leicht gefunden wird.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleRenameConfirm();
              }
            }}
            placeholder="Dateiname"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameDocument(null)}
            >
              Abbrechen
            </Button>
            <Button type="button" onClick={handleRenameConfirm} disabled={isPending}>
              Umbenennen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteDocumentTarget}
        onOpenChange={(open) => !open && setDeleteDocumentTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Datei in Papierkorb verschieben?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDocumentTarget ? getDeleteDescription(deleteDocumentTarget) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = deleteDocumentTarget;
                setDeleteDocumentTarget(null);
                if (!target) return;
                startTransition(async () => {
                  const result = await deleteDocument(target.id);
                  if (!result.success) {
                    showFeedback('error', 'Die Datei konnte nicht gelöscht werden.');
                    return;
                  }
                  showFeedback('success', 'Datei wurde in den Papierkorb verschoben.');
                  router.refresh();
                });
              }}
            >
              In Papierkorb verschieben
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canManage && (jobId || projectId || clientId || employeeId) && (
        <AttachDocumentDialog
          open={attachDialogOpen}
          onOpenChange={setAttachDialogOpen}
          targetType={
            jobId ? 'job' : projectId ? 'project' : clientId ? 'client' : 'employee'
          }
          targetId={jobId ?? projectId ?? clientId ?? employeeId!}
          targetLabel={contextLabel}
          onAttached={(variant, message) => {
            showFeedback(variant, message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
