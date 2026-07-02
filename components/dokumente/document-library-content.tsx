'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  MoveRight,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  X,
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
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  copyDocument,
  copyDocumentFolder,
  createDocumentFolder,
  deleteDocument,
  deleteDocumentFolder,
  getDocumentDetails,
  getDocumentStorageCleanupReport,
  getDocumentVersionSignedUrl,
  getDocumentSignedUrl,
  permanentlyDeleteDocument,
  moveDocument,
  moveDocumentFolder,
  renameDocument,
  renameDocumentFolder,
  restoreDocument,
  updateDocumentCategory,
  uploadDocumentVersion,
  deleteOrphanedStorageObjects,
} from '@/lib/documents/actions';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentEmployee,
  type DocumentLibraryCategoryFilter,
  type DocumentLibraryLinkFilter,
  type DocumentLibraryView,
  type DocumentFolder,
  type DocumentDetailsResult,
  type OrganizationDocument,
  type StorageCleanupReport,
} from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import {
  FeedbackBanner,
  type FeedbackBannerMessage,
} from '@/components/shared/feedback-banner';
import { DokumenteTabContentSkeleton } from '@/components/loading-states/dokumente-page-skeleton';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  DocumentUploadDialog,
  type DocumentUploadItem,
} from './document-upload-dialog';
import {
  DocumentLibraryTable,
  DOCUMENT_ROW_DRAG_MIME,
  type DocumentTableDragSelection,
} from './document-library-table';
import { DocumentViewerDialog } from './document-viewer-dialog';
import { DocumentLinkDialog } from './document-link-dialog';
import { DocumentWorkContextView } from './document-work-context-view';
import {
  DocumentActionsMenu,
  DocumentContextMenuContent,
  FolderActionsMenu,
  FolderContextMenuContent,
} from './document-row-actions';
import type { Job, ProjectWithDetails, Client } from '@/lib/jobs/types';

type DocumentLibraryContentProps = {
  view: DocumentLibraryView;
  searchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  currentFolderId: string | null;
  breadcrumbs: DocumentFolder[];
  folders: DocumentFolder[];
  allFolders: DocumentFolder[];
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
};

type MoveCopyDialogState = {
  mode: 'move' | 'copy';
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
  sourceFolderId: string | null;
} | null;

type DetailsDialogState = OrganizationDocument | null;

type RenameDialogState =
  | { kind: 'folder'; id: string; currentName: string }
  | { kind: 'document'; id: string; currentName: string }
  | null;

type LinkDialogState = OrganizationDocument | null;

type PendingDocumentNavigation = {
  view: DocumentLibraryView;
  folderId: string | null;
} | null;

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
} | null;

type DocumentOperationBannerState = {
  id: number;
  status: 'loading' | 'success' | 'error';
  message: string;
};

type BrowserFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type BrowserFileSystemFileEntry = BrowserFileSystemEntry & {
  file: (callback: (file: File) => void) => void;
};

type BrowserFileSystemDirectoryEntry = BrowserFileSystemEntry & {
  createReader: () => {
    readEntries: (callback: (entries: BrowserFileSystemEntry[]) => void) => void;
  };
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => BrowserFileSystemEntry | null;
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

function getUploaderName(document: OrganizationDocument): string {
  const uploader = document.uploader;
  if (!uploader) return 'Unbekannt';

  const fullName = [uploader.firstName, uploader.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return fullName || uploader.email || 'Unbekannt';
}

function getFolderHref(folderId: string | null): string {
  return folderId ? `/dokumente?folder=${encodeURIComponent(folderId)}` : '/dokumente';
}

function shouldUseDefaultLinkBehavior(
  event: ReactMouseEvent<HTMLAnchorElement>
): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function getViewHref({
  view,
  searchQuery,
  category,
  linkFilter,
}: {
  view: DocumentLibraryView;
  searchQuery: string;
  category?: DocumentLibraryCategoryFilter;
  linkFilter?: DocumentLibraryLinkFilter;
}): string {
  const params = new URLSearchParams();
  params.set('view', view);
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (view === 'all' && category && category !== 'all') params.set('category', category);
  if (view === 'all' && linkFilter && linkFilter !== 'all') params.set('link', linkFilter);
  return `/dokumente?${params.toString()}`;
}

function getFileIcon(document: OrganizationDocument) {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();

  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return FileText;
  if (mimeType.includes('spreadsheet') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
    return FileSpreadsheet;
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return FileArchive;
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return FileType;
  }
  return File;
}

function getFileTypeLabel(document: OrganizationDocument): string {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();

  if (mimeType.startsWith('image/')) return 'Bild';
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'PDF';
  if (mimeType.includes('spreadsheet') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
    return 'Tabelle';
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return 'Dokument';
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return 'Archiv';
  }
  return 'Datei';
}

function getLinkBadges(document: OrganizationDocument): string[] {
  return document.links.map((link) => {
    if (link.jobId) {
      return link.jobNumber
        ? `Auftrag ${link.jobNumber}`
        : link.jobTitle
          ? `Auftrag: ${link.jobTitle}`
          : 'Auftrag';
    }

    if (link.clientId) {
      return link.clientName ? `Kunde: ${link.clientName}` : 'Kunde';
    }

    if (link.employeeId) {
      return link.employeeName ? `Mitarbeiter: ${link.employeeName}` : 'Mitarbeiter';
    }

    return link.projectNumber
      ? `Projekt ${link.projectNumber}`
      : link.projectName
        ? `Projekt: ${link.projectName}`
        : 'Projekt';
  });
}

function getAuditEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    uploaded: 'Hochgeladen',
    renamed: 'Umbenannt',
    moved: 'Verschoben',
    copied: 'Kopiert',
    category_changed: 'Kategorie geändert',
    linked: 'Verknüpft',
    unlinked: 'Verknüpfung entfernt',
    deleted: 'In den Papierkorb verschoben',
    restored: 'Wiederhergestellt',
    version_uploaded: 'Neue Version hochgeladen',
    permanently_deleted: 'Endgültig gelöscht',
    storage_cleanup: 'Speicher bereinigt',
  };

  return labels[eventType] ?? 'Dokumentaktion';
}

function isDirectoryEntry(
  entry: BrowserFileSystemEntry
): entry is BrowserFileSystemDirectoryEntry {
  return entry.isDirectory;
}

function isFileEntry(
  entry: BrowserFileSystemEntry
): entry is BrowserFileSystemFileEntry {
  return entry.isFile;
}

function readFileEntry(entry: BrowserFileSystemFileEntry): Promise<File> {
  return new Promise((resolve) => entry.file(resolve));
}

function readDirectoryEntries(
  entry: BrowserFileSystemDirectoryEntry
): Promise<BrowserFileSystemEntry[]> {
  return new Promise((resolve) => {
    entry.createReader().readEntries(resolve);
  });
}

async function collectFilesFromEntry(
  entry: BrowserFileSystemEntry,
  parentPath = ''
): Promise<Array<{ file: File; relativePath: string }>> {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (isFileEntry(entry)) {
    const file = await readFileEntry(entry);
    return [{ file, relativePath }];
  }

  if (!isDirectoryEntry(entry)) return [];

  const children = await readDirectoryEntries(entry);
  const nestedFiles = await Promise.all(
    children.map((child) => collectFilesFromEntry(child, relativePath))
  );
  return nestedFiles.flat();
}

function getFolderPath(
  foldersById: Map<string, DocumentFolder>,
  folderId: string | null
): DocumentFolder[] {
  if (!folderId) return [];

  const path: DocumentFolder[] = [];
  const visitedFolderIds = new Set<string>();
  let currentFolder = foldersById.get(folderId);

  while (currentFolder && !visitedFolderIds.has(currentFolder.id)) {
    visitedFolderIds.add(currentFolder.id);
    path.unshift(currentFolder);
    currentFolder = currentFolder.parentFolderId
      ? foldersById.get(currentFolder.parentFolderId)
      : undefined;
  }

  return path;
}

function getDescendantFolderIds(
  folders: DocumentFolder[],
  folderIds: Set<string>
): Set<string> {
  const childIdsByParent = new Map<string, string[]>();

  for (const folder of folders) {
    if (!folder.parentFolderId) continue;
    const childIds = childIdsByParent.get(folder.parentFolderId) ?? [];
    childIds.push(folder.id);
    childIdsByParent.set(folder.parentFolderId, childIds);
  }

  const descendantIds = new Set<string>();
  const stack = Array.from(folderIds).flatMap(
    (folderId) => childIdsByParent.get(folderId) ?? []
  );

  while (stack.length > 0) {
    const folderId = stack.pop();
    if (!folderId || descendantIds.has(folderId)) continue;
    descendantIds.add(folderId);
    stack.push(...(childIdsByParent.get(folderId) ?? []));
  }

  return descendantIds;
}

function getTopLevelSelectedFolders(
  folders: DocumentFolder[],
  allFolders: DocumentFolder[]
): DocumentFolder[] {
  if (folders.length <= 1) return folders;

  const selectedFolderIds = new Set(folders.map((folder) => folder.id));
  const foldersById = new Map(allFolders.map((folder) => [folder.id, folder]));

  return folders.filter((folder) => {
    let parentFolderId = folder.parentFolderId;

    while (parentFolderId) {
      if (selectedFolderIds.has(parentFolderId)) return false;
      parentFolderId = foldersById.get(parentFolderId)?.parentFolderId ?? null;
    }

    return true;
  });
}

function getSourceFolderKey(folderId: string | null): string {
  return folderId ?? 'root';
}

function getSelectedSourceFolderKeys({
  documents,
  folders,
}: {
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
}): Set<string> {
  return new Set([
    ...documents.map((document) => getSourceFolderKey(document.folderId)),
    ...folders.map((folder) => getSourceFolderKey(folder.parentFolderId)),
  ]);
}

type MoveDestinationDialogProps = {
  open: boolean;
  mode: 'move' | 'copy';
  title: string;
  description: string;
  allFolders: DocumentFolder[];
  visibleDocuments: OrganizationDocument[];
  selectedDocuments: OrganizationDocument[];
  selectedFolders: DocumentFolder[];
  sourceFolderId: string | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetFolderId: string | null) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onOpenDocument: (document: OrganizationDocument) => void;
};

function MoveDestinationDialog({
  open,
  mode,
  title,
  description,
  allFolders,
  visibleDocuments,
  selectedDocuments,
  selectedFolders,
  sourceFolderId,
  isPending,
  onOpenChange,
  onConfirm,
  onCreateFolder,
  onOpenDocument,
}: MoveDestinationDialogProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(
    sourceFolderId
  );
  const selectedFolderIds = useMemo(
    () => new Set(selectedFolders.map((folder) => folder.id)),
    [selectedFolders]
  );
  const selectedDocumentIds = useMemo(
    () => new Set(selectedDocuments.map((document) => document.id)),
    [selectedDocuments]
  );
  const foldersById = useMemo(
    () => new Map(allFolders.map((folder) => [folder.id, folder])),
    [allFolders]
  );
  const descendantFolderIds = useMemo(
    () => getDescendantFolderIds(allFolders, selectedFolderIds),
    [allFolders, selectedFolderIds]
  );
  const breadcrumbFolders = useMemo(
    () => getFolderPath(foldersById, currentFolderId),
    [currentFolderId, foldersById]
  );
  const childFolders = useMemo(
    () =>
      allFolders
        .filter((folder) => folder.parentFolderId === currentFolderId)
        .sort((firstFolder, secondFolder) =>
          firstFolder.name.localeCompare(secondFolder.name, 'de-DE', {
            numeric: true,
            sensitivity: 'base',
          })
        ),
    [allFolders, currentFolderId]
  );
  const documentsInCurrentFolder = useMemo(
    () =>
      visibleDocuments.filter(
        (document) => document.folderId === currentFolderId
      ),
    [currentFolderId, visibleDocuments]
  );
  const selectedSourceFolderKeys = useMemo(
    () =>
      getSelectedSourceFolderKeys({
        documents: selectedDocuments,
        folders: selectedFolders,
      }),
    [selectedDocuments, selectedFolders]
  );
  const targetFolderIsSelected =
    currentFolderId !== null && selectedFolderIds.has(currentFolderId);
  const targetFolderIsDescendant =
    currentFolderId !== null && descendantFolderIds.has(currentFolderId);
  const isSameMoveDestination =
    mode === 'move' &&
    selectedSourceFolderKeys.has(getSourceFolderKey(currentFolderId));
  const confirmDisabled =
    isPending ||
    targetFolderIsSelected ||
    targetFolderIsDescendant ||
    isSameMoveDestination;
  const disabledReason = targetFolderIsSelected
    ? 'Ein Ordner kann nicht in sich selbst verschoben werden.'
    : targetFolderIsDescendant
      ? 'Ein Ordner kann nicht in einen Unterordner von sich selbst verschoben werden.'
      : isSameMoveDestination
        ? 'Wähle einen anderen Zielordner aus.'
        : null;

  function renderSelectedItemPill(label: ReactNode) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,90vh)] !w-[min(1280px,calc(100vw-3rem))] !max-w-none flex-col gap-0 overflow-hidden p-0 sm:!max-w-none">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
            <div className="flex shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onCreateFolder(currentFolderId)}
                disabled={isPending}
              >
                <FolderPlus className="size-4" />
                Neuer Ordner
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-muted/20 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden border-r bg-background/80 p-4 text-sm lg:block">
            <p className="font-medium">
              {mode === 'copy' ? 'Kopieren nach' : 'Verschieben nach'}
            </p>
            <div className="mt-4 space-y-2 text-muted-foreground">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted hover:text-foreground',
                  currentFolderId === null && 'bg-muted text-foreground'
                )}
                onClick={() => setCurrentFolderId(null)}
              >
                <Folder className="size-4" />
                Dokumente
              </button>
              <p className="px-2 pt-3 text-xs font-medium uppercase tracking-wide">
                Auswahl
              </p>
              <div className="flex flex-wrap gap-1 px-2">
                {selectedFolders.length > 0 &&
                  renderSelectedItemPill(
                    selectedFolders.length === 1
                      ? '1 Ordner'
                      : `${selectedFolders.length} Ordner`
                  )}
                {selectedDocuments.length > 0 &&
                  renderSelectedItemPill(
                    selectedDocuments.length === 1
                      ? '1 Dokument'
                      : `${selectedDocuments.length} Dokumente`
                  )}
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-12 items-center gap-1 border-b bg-background px-4 text-sm">
              <button
                type="button"
                className={cn(
                  'rounded-md px-2 py-1 font-medium transition-colors hover:bg-muted',
                  currentFolderId === null && 'bg-muted'
                )}
                onClick={() => setCurrentFolderId(null)}
              >
                Dokumente
              </button>
              {breadcrumbFolders.map((folder) => (
                <div key={folder.id} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className={cn(
                      'truncate rounded-md px-2 py-1 font-medium transition-colors hover:bg-muted',
                      folder.id === currentFolderId && 'bg-muted'
                    )}
                    onClick={() => setCurrentFolderId(folder.id)}
                  >
                    {folder.name}
                  </button>
                </div>
              ))}
            </div>

            <div
              className="min-h-0 flex-1 overflow-auto p-4"
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="min-w-[720px] overflow-hidden rounded-md border bg-background">
                <div className="grid grid-cols-[minmax(360px,1fr)_140px_160px] border-b px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>Name</span>
                  <span>Typ</span>
                  <span>Geändert</span>
                </div>
                <div className="divide-y">
                  {childFolders.map((folder) => {
                    const isDisabled =
                      selectedFolderIds.has(folder.id) ||
                      descendantFolderIds.has(folder.id);

                    return (
                      <div
                        key={folder.id}
                        className={cn(
                          'grid w-full grid-cols-[minmax(360px,1fr)_140px_160px] items-center px-4 py-3 text-left text-sm transition-colors hover:bg-muted/70',
                          isDisabled && 'cursor-not-allowed'
                        )}
                        onDoubleClick={() => {
                          if (!isDisabled) setCurrentFolderId(folder.id);
                        }}
                      >
                        <span
                          className={cn(
                            'flex min-w-0 items-center gap-2 font-medium',
                            isDisabled && 'opacity-45'
                          )}
                        >
                          <Folder className="size-4 shrink-0 text-orange-500" />
                          <button
                            type="button"
                            className="truncate text-left hover:underline"
                            onClick={() => {
                              if (!isDisabled) setCurrentFolderId(folder.id);
                            }}
                            disabled={isDisabled}
                          >
                            {folder.name}
                          </button>
                        </span>
                        <span
                          className={cn(
                            'text-muted-foreground',
                            isDisabled && 'opacity-45'
                          )}
                        >
                          Ordner
                        </span>
                        <span
                          className={cn(
                            'text-muted-foreground',
                            isDisabled && 'opacity-45'
                          )}
                        >
                          {formatDate(folder.updatedAt)}
                        </span>
                      </div>
                    );
                  })}
                  {documentsInCurrentFolder.map((document) => {
                    const FileIcon = getFileIcon(document);
                    const isSelected = selectedDocumentIds.has(document.id);

                    return (
                      <div
                        key={document.id}
                        className={cn(
                          'grid grid-cols-[minmax(360px,1fr)_140px_160px] items-center px-4 py-3 text-sm',
                          isSelected
                            ? 'bg-muted/70 text-muted-foreground opacity-60'
                            : 'text-muted-foreground'
                        )}
                        onDoubleClick={() => onOpenDocument(document)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FileIcon className="size-4 shrink-0" />
                          <button
                            type="button"
                            className="truncate text-left hover:underline"
                            onClick={() => onOpenDocument(document)}
                          >
                            {document.displayName}
                          </button>
                        </span>
                        <span>{getFileTypeLabel(document)}</span>
                        <span>{formatDate(document.updatedAt)}</span>
                      </div>
                    );
                  })}
                  {childFolders.length === 0 && documentsInCurrentFolder.length === 0 && (
                    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                      Dieser Ordner ist leer.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-h-5 text-sm text-muted-foreground">
                {disabledReason ?? 'Wähle den Zielordner und bestätige den Vorgang.'}
              </p>
              <div className="flex shrink-0 justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  onClick={() => onConfirm(currentFolderId)}
                  disabled={confirmDisabled}
                >
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {mode === 'copy' ? 'Hierhin kopieren' : 'Hierhin verschieben'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentOperationBanner({
  operation,
}: {
  operation: DocumentOperationBannerState | null;
}) {
  if (!operation) return null;

  return (
    <div
      className={cn(
        'fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-lg',
        'animate-banner-in'
      )}
    >
      <div className="overflow-hidden rounded-lg bg-orange-50 p-4 text-orange-900 shadow-lg ring-1 ring-orange-200/50 dark:bg-orange-950 dark:text-orange-100 dark:ring-orange-800/50">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 shrink-0 animate-spin" />
          <p className="flex-1 text-sm font-medium">{operation.message}</p>
        </div>
        {operation.status === 'loading' && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-orange-200/70 dark:bg-orange-900">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </div>
    </div>
  );
}

export function DocumentLibraryContent({
  view,
  searchQuery: initialSearchQuery,
  category,
  linkFilter,
  currentFolderId,
  breadcrumbs,
  folders,
  allFolders,
  documents,
  jobs,
  projects,
  clients,
  employees,
}: DocumentLibraryContentProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const feedbackIdRef = useRef(0);
  const operationBannerIdRef = useRef(0);
  const operationBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const uploadItemIdRef = useRef(0);
  const suppressNextSelectionClearRef = useRef(false);
  const [isPending, startTransition] = useTransition();
  const [isNavigationPending, startNavigationTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackBannerMessage | null>(null);
  const [operationBanner, setOperationBanner] =
    useState<DocumentOperationBannerState | null>(null);
  const [isMoveCopySubmitting, setIsMoveCopySubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [moveCopyDialog, setMoveCopyDialog] = useState<MoveCopyDialogState>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState>(null);
  const [detailsDialog, setDetailsDialog] = useState<DetailsDialogState>(null);
  const [detailsData, setDetailsData] = useState<
    Extract<DocumentDetailsResult, { success: true }> | null
  >(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [viewerDocument, setViewerDocument] = useState<OrganizationDocument | null>(null);
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [cleanupReport, setCleanupReport] = useState<StorageCleanupReport | null>(null);
  const [isCleanupLoading, setIsCleanupLoading] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(
    () => new Set()
  );
  const [folderDialogParentFolderId, setFolderDialogParentFolderId] =
    useState<string | null | undefined>(undefined);
  const [draggedTableSelection, setDraggedTableSelection] =
    useState<DocumentTableDragSelection | null>(null);
  const [isTrashDragOver, setIsTrashDragOver] = useState(false);
  const [breadcrumbDropTargetId, setBreadcrumbDropTargetId] = useState<
    string | 'root' | null
  >(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<DocumentUploadItem[]>([]);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingDocumentNavigation>(null);
  const visibleView = pendingNavigation?.view ?? view;
  const isTrashView = visibleView === 'trash';
  const isWorkView = visibleView === 'work';
  const showNavigationSkeleton = pendingNavigation !== null;
  const linkDialogCatalogIsPrefetched =
    view === 'work' &&
    (jobs.length > 0 ||
      projects.length > 0 ||
      clients.length > 0 ||
      employees.length > 0);

  useRealtimeRouterRefresh({
    tables: [
      'documents',
      'document_folders',
      'document_links',
    ],
    debounceMs: 250,
  });

  useEffect(() => {
    setSearchQuery(initialSearchQuery);
    setPendingNavigation(null);
  }, [category, currentFolderId, initialSearchQuery, linkFilter, view]);

  useEffect(() => {
    if (!pendingNavigation) return;

    const timeoutId = window.setTimeout(() => {
      setPendingNavigation(null);
    }, 10000);

    return () => window.clearTimeout(timeoutId);
  }, [pendingNavigation]);

  useEffect(() => {
    return () => {
      if (operationBannerTimeoutRef.current) {
        clearTimeout(operationBannerTimeoutRef.current);
      }
    };
  }, []);

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedDocumentIds.has(document.id)),
    [documents, selectedDocumentIds]
  );
  const selectedFolders = useMemo(
    () => allFolders.filter((folder) => selectedFolderIds.has(folder.id)),
    [allFolders, selectedFolderIds]
  );
  const selectedItemCount = selectedDocuments.length + selectedFolders.length;
  const activeFilterCount =
    (category !== 'all' ? 1 : 0) + (linkFilter !== 'all' ? 1 : 0);

  function getSharedSourceFolderId({
    documentsToCheck,
    foldersToCheck,
  }: {
    documentsToCheck: OrganizationDocument[];
    foldersToCheck: DocumentFolder[];
  }): string | null {
    const sourceFolderIds = [
      ...documentsToCheck.map((document) => document.folderId ?? 'root'),
      ...foldersToCheck.map((folder) => folder.parentFolderId ?? 'root'),
    ];

    if (sourceFolderIds.length === 0) return currentFolderId;
    const firstSourceFolderId = sourceFolderIds[0];
    const allSameSource = sourceFolderIds.every(
      (sourceFolderId) => sourceFolderId === firstSourceFolderId
    );

    return allSameSource && firstSourceFolderId !== 'root'
      ? firstSourceFolderId
      : null;
  }

  useEffect(() => {
    if (!renameDialog) return;
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameDialog]);

  function showFeedback(variant: 'success' | 'error', message: string) {
    feedbackIdRef.current += 1;
    setFeedback({ id: feedbackIdRef.current, variant, message });
  }

  function showOperationBanner(
    status: DocumentOperationBannerState['status'],
    message: string,
    options: { autoDismiss?: boolean } = {}
  ) {
    if (operationBannerTimeoutRef.current) {
      clearTimeout(operationBannerTimeoutRef.current);
      operationBannerTimeoutRef.current = null;
    }

    operationBannerIdRef.current += 1;
    setOperationBanner({
      id: operationBannerIdRef.current,
      status,
      message,
    });

    if (options.autoDismiss) {
      operationBannerTimeoutRef.current = setTimeout(() => {
        setOperationBanner(null);
        operationBannerTimeoutRef.current = null;
      }, 2600);
    }
  }

  function targetContainsSelectedFolder(
    foldersToProcess: DocumentFolder[],
    destinationFolderId: string | null
  ): boolean {
    if (!destinationFolderId || foldersToProcess.length === 0) return false;

    const folderIds = new Set(foldersToProcess.map((folder) => folder.id));
    if (folderIds.has(destinationFolderId)) return true;

    return getDescendantFolderIds(allFolders, folderIds).has(destinationFolderId);
  }

  function targetContainsSelectedItemCurrentLocation({
    documentsToProcess,
    foldersToProcess,
    destinationFolderId,
  }: {
    documentsToProcess: OrganizationDocument[];
    foldersToProcess: DocumentFolder[];
    destinationFolderId: string | null;
  }): boolean {
    const destinationKey = getSourceFolderKey(destinationFolderId);

    return (
      documentsToProcess.some(
        (document) => getSourceFolderKey(document.folderId) === destinationKey
      ) ||
      foldersToProcess.some(
        (folder) => getSourceFolderKey(folder.parentFolderId) === destinationKey
      )
    );
  }

  async function runMoveCopyOperation({
    mode,
    documentsToProcess,
    foldersToProcess,
    destinationFolderId,
    onSuccess,
  }: {
    mode: 'move' | 'copy';
    documentsToProcess: OrganizationDocument[];
    foldersToProcess: DocumentFolder[];
    destinationFolderId: string | null;
    onSuccess: () => void;
  }) {
    if (isMoveCopySubmitting) return;

    const itemCount = documentsToProcess.length + foldersToProcess.length;
    if (itemCount === 0) return;

    if (targetContainsSelectedFolder(foldersToProcess, destinationFolderId)) {
      showFeedback(
        'error',
        mode === 'copy'
          ? 'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner kopiert werden.'
          : 'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner verschoben werden.'
      );
      return;
    }

    if (
      mode === 'move' &&
      targetContainsSelectedItemCurrentLocation({
        documentsToProcess,
        foldersToProcess,
        destinationFolderId,
      })
    ) {
      showFeedback(
        'error',
        'Einträge können nicht in ihren aktuellen Ordner verschoben werden.'
      );
      return;
    }

    const topLevelFoldersToProcess = getTopLevelSelectedFolders(
      foldersToProcess,
      allFolders
    );
    const actionLabel = mode === 'copy' ? 'kopiert' : 'verschoben';
    setIsMoveCopySubmitting(true);
    showOperationBanner(
      'loading',
      itemCount === 1
        ? `1 Eintrag wird ${actionLabel}...`
        : `${itemCount} Einträge werden ${actionLabel}...`
    );

    try {
      let failedCount = 0;

      for (const document of documentsToProcess) {
        const result =
          mode === 'move'
            ? await moveDocument({
                documentId: document.id,
                folderId: destinationFolderId,
              })
            : await copyDocument({
                documentId: document.id,
                targetFolderId: destinationFolderId,
              });

        if (!result.success) failedCount++;
      }

      for (const folder of topLevelFoldersToProcess) {
        const result =
          mode === 'move'
            ? await moveDocumentFolder({
                folderId: folder.id,
                parentFolderId: destinationFolderId,
              })
            : await copyDocumentFolder({
                folderId: folder.id,
                targetParentFolderId: destinationFolderId,
              });

        if (!result.success) failedCount++;
      }

      if (failedCount > 0) {
        const failedItemLabel =
          failedCount === 1 ? '1 Eintrag' : `${failedCount} Einträge`;
        setOperationBanner(null);
        showFeedback(
          'error',
          `${failedItemLabel} ${failedCount === 1 ? 'konnte' : 'konnten'} nicht ${actionLabel} werden.`
        );
        return;
      }

      onSuccess();
      clearSelection();
      refreshDocuments();
      setOperationBanner(null);
      showFeedback(
        'success',
        itemCount === 1
          ? `1 Eintrag wurde ${actionLabel}.`
          : `${itemCount} Einträge wurden ${actionLabel}.`
      );
    } catch (error) {
      console.error('Failed to run document move/copy operation:', error);
      setOperationBanner(null);
      showFeedback(
        'error',
        mode === 'copy'
          ? 'Die Auswahl konnte nicht kopiert werden.'
          : 'Die Auswahl konnte nicht verschoben werden.'
      );
    } finally {
      setIsMoveCopySubmitting(false);
    }
  }

  function refreshDocuments() {
    router.refresh();
  }

  function navigateToDocumentLocation({
    href,
    targetView,
    targetFolderId,
  }: {
    href: string;
    targetView: DocumentLibraryView;
    targetFolderId: string | null;
  }) {
    if (targetView === view && targetFolderId === currentFolderId) return;

    setPendingNavigation({ view: targetView, folderId: targetFolderId });
    clearSelection();
    startNavigationTransition(() => {
      router.push(href);
    });
  }

  function replaceDocumentLocation({
    href,
    targetView,
    targetFolderId,
  }: {
    href: string;
    targetView: DocumentLibraryView;
    targetFolderId: string | null;
  }) {
    setPendingNavigation({ view: targetView, folderId: targetFolderId });
    startNavigationTransition(() => {
      router.replace(href);
    });
  }

  function navigateToFolder(folderId: string | null) {
    navigateToDocumentLocation({
      href: folderId
        ? getFolderHref(folderId)
        : getViewHref({
            view: 'folders',
            searchQuery,
            category,
            linkFilter,
          }),
      targetView: 'folders',
      targetFolderId: folderId,
    });
  }

  function openDocumentViewer(document: OrganizationDocument) {
    setViewerDocument(document);
  }

  function openDetailsDialog(document: OrganizationDocument) {
    setDetailsDialog(document);
    setDetailsData(null);
    setIsDetailsLoading(true);

    startTransition(async () => {
      const result = await getDocumentDetails(document.id);
      if (!result.success) {
        showFeedback('error', 'Die Dateidetails konnten nicht geladen werden.');
        setIsDetailsLoading(false);
        return;
      }

      setDetailsData(result);
      setIsDetailsLoading(false);
    });
  }

  function updateSearch({
    nextSearchQuery = searchQuery,
    nextCategory = category,
    nextLinkFilter = linkFilter,
  }: {
    nextSearchQuery?: string;
    nextCategory?: DocumentLibraryCategoryFilter;
    nextLinkFilter?: DocumentLibraryLinkFilter;
  } = {}) {
    const params = new URLSearchParams();
    if (view !== 'folders') params.set('view', view);
    if (currentFolderId) params.set('folder', currentFolderId);
    if (nextSearchQuery.trim()) params.set('q', nextSearchQuery.trim());
    if (view === 'all' && nextCategory !== 'all') {
      params.set('category', nextCategory);
    }
    if (view === 'all' && nextLinkFilter !== 'all') {
      params.set('link', nextLinkFilter);
    }
    replaceDocumentLocation({
      href: `/dokumente${params.size > 0 ? `?${params.toString()}` : ''}`,
      targetView: currentFolderId ? 'folders' : view,
      targetFolderId: currentFolderId,
    });
  }

  function handleCreateFolder() {
    if (isTrashView) return;
    const name = folderName.trim();
    if (!name) return;
    const parentFolderId =
      folderDialogParentFolderId === undefined
        ? currentFolderId
        : folderDialogParentFolderId;

    startTransition(async () => {
      const result = await createDocumentFolder({
        name,
        parentFolderId,
      });
      if (!result.success) {
        showFeedback('error', 'Der Ordner konnte nicht erstellt werden.');
        return;
      }

      setFolderName('');
      setFolderDialogOpen(false);
      setFolderDialogParentFolderId(undefined);
      refreshDocuments();
    });
  }

  function openCreateFolderDialog(parentFolderId: string | null = currentFolderId) {
    setFolderDialogParentFolderId(parentFolderId);
    setFolderDialogOpen(true);
  }

  function buildUploadItems(
    files: Array<{ file: File; relativePath?: string }>
  ): DocumentUploadItem[] {
    return files.map(({ file, relativePath }) => {
      uploadItemIdRef.current += 1;
      return {
        id: `document-upload-${uploadItemIdRef.current}`,
        file,
        relativePath,
      };
    });
  }

  function openUploadDialog(files: Array<{ file: File; relativePath?: string }>) {
    if (isTrashView) return;
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
        relativePath:
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name,
      }))
    );
  }

  function openRenameFolderDialog(folder: DocumentFolder) {
    setRenameDialog({ kind: 'folder', id: folder.id, currentName: folder.name });
    setRenameValue(folder.name);
  }

  function openRenameDocumentDialog(document: OrganizationDocument) {
    if (isTrashView) return;
    setRenameDialog({
      kind: 'document',
      id: document.id,
      currentName: document.displayName,
    });
    setRenameValue(document.displayName);
  }

  function openLinkDialog(document: OrganizationDocument) {
    if (isTrashView) return;
    setLinkDialog(document);
  }

  function handleRenameConfirm() {
    if (!renameDialog) return;
    const nextName = renameValue.trim();
    if (!nextName || nextName === renameDialog.currentName) {
      setRenameDialog(null);
      return;
    }

    startTransition(async () => {
      const result =
        renameDialog.kind === 'folder'
          ? await renameDocumentFolder({
              folderId: renameDialog.id,
              name: nextName,
            })
          : await renameDocument({
              documentId: renameDialog.id,
              displayName: nextName,
            });
      if (!result.success) {
        showFeedback(
          'error',
          renameDialog.kind === 'folder'
            ? 'Der Ordner konnte nicht umbenannt werden.'
            : 'Die Datei konnte nicht umbenannt werden.'
        );
      }
      setRenameDialog(null);
      refreshDocuments();
    });
  }

  function handleDeleteFolder(folder: DocumentFolder) {
    setConfirmDialog({
      title: 'Ordner löschen?',
      description: `Der Ordner „${folder.name}“ und alle enthaltenen Dateien werden in den Papierkorb verschoben.`,
      confirmLabel: 'Ordner löschen',
      onConfirm: () => {
        startTransition(async () => {
          const result = await deleteDocumentFolder(folder.id);
          if (!result.success) {
            showFeedback('error', 'Der Ordner konnte nicht gelöscht werden.');
          }
          setSelectedFolderIds((current) => {
            const next = new Set(current);
            next.delete(folder.id);
            return next;
          });
          refreshDocuments();
        });
      },
    });
  }

  function handleUpdateCategory(document: OrganizationDocument, category: DocumentCategory) {
    if (isTrashView) return;
    startTransition(async () => {
      const result = await updateDocumentCategory({
        documentId: document.id,
        category,
      });

      if (!result.success) {
        showFeedback('error', 'Die Kategorie konnte nicht geändert werden.');
      }

      setDetailsDialog(result.success ? result.document : document);
      refreshDocuments();
    });
  }

  function handleDeleteDocument(document: OrganizationDocument) {
    setConfirmDialog({
      title: 'Datei löschen?',
      description: `„${document.displayName}“ wird in den Papierkorb verschoben und kann dort wiederhergestellt werden.`,
      confirmLabel: 'Datei löschen',
      onConfirm: () => {
        startTransition(async () => {
          const result = await deleteDocument(document.id);
          if (!result.success) {
            showFeedback('error', 'Die Datei konnte nicht gelöscht werden.');
          }
          setSelectedDocumentIds((current) => {
            const next = new Set(current);
            next.delete(document.id);
            return next;
          });
          refreshDocuments();
        });
      },
    });
  }

  function handleRestoreDocument(document: OrganizationDocument) {
    startTransition(async () => {
      const result = await restoreDocument(document.id);
      if (!result.success) {
        showFeedback('error', 'Die Datei konnte nicht wiederhergestellt werden.');
      } else {
        showFeedback('success', 'Datei wurde wiederhergestellt.');
      }
      setSelectedDocumentIds((current) => {
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
      refreshDocuments();
    });
  }

  function handlePermanentDeleteDocument(document: OrganizationDocument) {
    setConfirmDialog({
      title: 'Datei endgültig löschen?',
      description: `„${document.displayName}“ wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`,
      confirmLabel: 'Endgültig löschen',
      onConfirm: () => {
        startTransition(async () => {
          const result = await permanentlyDeleteDocument(document.id);
          if (!result.success) {
            showFeedback('error', 'Die Datei konnte nicht endgültig gelöscht werden.');
          }
          setSelectedDocumentIds((current) => {
            const next = new Set(current);
            next.delete(document.id);
            return next;
          });
          refreshDocuments();
        });
      },
    });
  }

  function openMoveCopyDialog(
    item:
      | { kind: 'document'; document: OrganizationDocument }
      | { kind: 'folder'; folder: DocumentFolder },
    mode: 'move' | 'copy'
  ) {
    if (isTrashView) return;

    const shouldUseCurrentSelection =
      item.kind === 'document'
        ? selectedDocuments.some((document) => document.id === item.document.id)
        : selectedFolders.some((folder) => folder.id === item.folder.id);
    const documentsToUse = shouldUseCurrentSelection
      ? selectedDocuments
      : item.kind === 'document'
        ? [item.document]
        : [];
    const foldersToUse = shouldUseCurrentSelection
      ? selectedFolders
      : item.kind === 'folder'
        ? [item.folder]
        : [];

    setMoveCopyDialog({
      mode,
      documents: documentsToUse,
      folders: foldersToUse,
      sourceFolderId: getSharedSourceFolderId({
        documentsToCheck: documentsToUse,
        foldersToCheck: foldersToUse,
      }),
    });
  }

  function openMoveCopyDialogForSelection(mode: 'move' | 'copy') {
    if (isTrashView || selectedItemCount === 0) return;

    setMoveCopyDialog({
      mode,
      documents: selectedDocuments,
      folders: selectedFolders,
      sourceFolderId: getSharedSourceFolderId({
        documentsToCheck: selectedDocuments,
        foldersToCheck: selectedFolders,
      }),
    });
  }

  function handleMoveCopyConfirm(destinationFolderId: string | null) {
    if (!moveCopyDialog) return;

    void runMoveCopyOperation({
      mode: moveCopyDialog.mode,
      documentsToProcess: moveCopyDialog.documents,
      foldersToProcess: moveCopyDialog.folders,
      destinationFolderId,
      onSuccess: () => {
        setMoveCopyDialog(null);
      },
    });
  }
  function handleDownload(document: OrganizationDocument) {
    startTransition(async () => {
      const result = await getDocumentSignedUrl(document.id);
      if (!result.success) {
        showFeedback('error', 'Die Datei konnte nicht geöffnet werden.');
        return;
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
    });
  }

  function handleVersionUpload(files: FileList | null) {
    if (!detailsDialog || !files?.[0]) return;

    const formData = new FormData();
    formData.set('file', files[0]);

    startTransition(async () => {
      const result = await uploadDocumentVersion({
        documentId: detailsDialog.id,
        formData,
      });

      if (!result.success) {
        showFeedback('error', 'Die neue Version konnte nicht hochgeladen werden.');
      } else {
        showFeedback('success', 'Neue Version wurde hochgeladen.');
        openDetailsDialog(detailsDialog);
      }

      if (versionInputRef.current) versionInputRef.current.value = '';
      refreshDocuments();
    });
  }

  function handleDownloadVersion(versionId: string) {
    startTransition(async () => {
      const result = await getDocumentVersionSignedUrl(versionId, { download: true });
      if (!result.success) {
        showFeedback('error', 'Die Version konnte nicht geöffnet werden.');
        return;
      }
      window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
    });
  }

  function openCleanupDialog() {
    setCleanupDialogOpen(true);
    setIsCleanupLoading(true);
    setCleanupReport(null);

    startTransition(async () => {
      const result = await getDocumentStorageCleanupReport();
      if (!result.success) {
        showFeedback('error', 'Der Speicherbericht konnte nicht erstellt werden.');
        setIsCleanupLoading(false);
        return;
      }

      setCleanupReport(result.report);
      setIsCleanupLoading(false);
    });
  }

  function handleDeleteOrphanedObjects() {
    if (!cleanupReport?.orphanedStoragePaths.length) return;

    setConfirmDialog({
      title: 'Verwaiste Speicherobjekte löschen?',
      description: `${cleanupReport.orphanedStoragePaths.length} verwaiste Speicherobjekt(e) werden endgültig gelöscht.`,
      confirmLabel: 'Objekte löschen',
      onConfirm: () => {
        startTransition(async () => {
          const result = await deleteOrphanedStorageObjects(
            cleanupReport.orphanedStoragePaths
          );
          if (!result.success) {
            showFeedback(
              'error',
              'Verwaiste Speicherobjekte konnten nicht gelöscht werden.'
            );
            return;
          }

          showFeedback('success', 'Verwaiste Speicherobjekte wurden gelöscht.');
          openCleanupDialog();
        });
      },
    });
  }

  function hasExternalFileDrag(dataTransfer: DataTransfer): boolean {
    return (
      Array.from(dataTransfer.types).includes('Files') ||
      Array.from(dataTransfer.items).some((item) => item.kind === 'file') ||
      dataTransfer.files.length > 0
    );
  }

  function hasInternalRowDrag(dataTransfer: DataTransfer): boolean {
    return Array.from(dataTransfer.types).includes(
      DOCUMENT_ROW_DRAG_MIME
    );
  }

  function readInternalRowDragSelection(
    dataTransfer: DataTransfer
  ): DocumentTableDragSelection | null {
    const raw = dataTransfer.getData(DOCUMENT_ROW_DRAG_MIME);
    if (!raw) return draggedTableSelection;

    try {
      const parsed = JSON.parse(raw) as Partial<DocumentTableDragSelection>;
      return {
        folderIds: Array.isArray(parsed.folderIds) ? parsed.folderIds : [],
        documentIds: Array.isArray(parsed.documentIds) ? parsed.documentIds : [],
      };
    } catch {
      return draggedTableSelection;
    }
  }

  function getSelectionItems(selection: DocumentTableDragSelection) {
    return {
      documentsToUse: documents.filter((document) =>
        selection.documentIds.includes(document.id)
      ),
      foldersToUse: folders.filter((folder) => selection.folderIds.includes(folder.id)),
    };
  }

  function canDropSelectionIntoFolder(
    selection: DocumentTableDragSelection,
    targetFolderId: string | null,
    { disallowCurrentFolder = false }: { disallowCurrentFolder?: boolean } = {}
  ): boolean {
    if (disallowCurrentFolder && targetFolderId === currentFolderId) return false;
    if (!targetFolderId) return true;
    if (selection.folderIds.includes(targetFolderId)) return false;

    const descendantFolderIds = getDescendantFolderIds(
      allFolders,
      new Set(selection.folderIds)
    );
    return !descendantFolderIds.has(targetFolderId);
  }

  function moveSelectionIntoFolder(
    selection: DocumentTableDragSelection,
    targetFolderId: string | null
  ) {
    if (isTrashView) return;
    const { documentsToUse, foldersToUse } = getSelectionItems(selection);
    const filteredFoldersToMove = foldersToUse.filter(
      (folder) => folder.id !== targetFolderId
    );

    if (documentsToUse.length === 0 && filteredFoldersToMove.length === 0) return;

    startTransition(async () => {
      let failedCount = 0;

      for (const document of documentsToUse) {
        const result = await moveDocument({
          documentId: document.id,
          folderId: targetFolderId,
        });
        if (!result.success) failedCount++;
      }

      for (const folder of filteredFoldersToMove) {
        const result = await moveDocumentFolder({
          folderId: folder.id,
          parentFolderId: targetFolderId,
        });
        if (!result.success) failedCount++;
      }

      if (failedCount > 0) {
        showFeedback(
          'error',
          `${failedCount} Eintrag/Einträge konnten nicht verschoben werden.`
        );
      } else {
        showFeedback('success', 'Auswahl wurde verschoben.');
      }

      clearSelection();
      refreshDocuments();
    });
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
    if (isTrashView) return;

    const entries = Array.from(event.dataTransfer.items)
      .map((item) => {
        const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null;
        return entry as BrowserFileSystemEntry | null;
      })
      .filter((entry): entry is BrowserFileSystemEntry => Boolean(entry));

    const directoryEntries = entries.filter(isDirectoryEntry);
    if (view === 'folders' && directoryEntries.length === 0) {
      showFeedback(
        'error',
        'Ziehe hier einen Ordner hinein oder nutze Hochladen.'
      );
      return;
    }

    if (directoryEntries.length > 0) {
      const nestedFiles = await Promise.all(
        directoryEntries.map((entry) => collectFilesFromEntry(entry))
      );
      openUploadDialog(nestedFiles.flat());
      return;
    }

    handleUpload(event.dataTransfer.files);
  }

  function toggleDocumentSelection(documentId: string) {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }

  function toggleFolderSelection(folderId: string) {
    setSelectedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set());
  }

  useEffect(() => {
    clearSelection();
  }, [currentFolderId, view]);

  useEffect(() => {
    if (selectedItemCount === 0) return;

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (suppressNextSelectionClearRef.current) {
        suppressNextSelectionClearRef.current = false;
        return;
      }
      if (target?.closest('[data-document-selection-circle="true"]')) return;
      if (target?.closest('[data-document-selection-preserve="true"]')) return;
      if (target?.closest('[role="menu"], [data-radix-popper-content-wrapper]')) {
        return;
      }
      window.setTimeout(clearSelection, 0);
    }

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [selectedItemCount]);

  function openDeleteConfirmationForSelection({
    documentsToDelete,
    foldersToDelete,
  }: {
    documentsToDelete: OrganizationDocument[];
    foldersToDelete: DocumentFolder[];
  }) {
    const itemCount = documentsToDelete.length + foldersToDelete.length;
    if (itemCount === 0) return;
    const selectedItemLabel =
      itemCount === 1 ? '1 Eintrag' : `${itemCount} Einträge`;

    setConfirmDialog({
      title: 'Ausgewählte Einträge löschen?',
      description: `${selectedItemLabel} ${
        itemCount === 1 ? 'wird' : 'werden'
      } in den Papierkorb verschoben.`,
      confirmLabel: 'Einträge löschen',
      onConfirm: () => {
        startTransition(async () => {
          let failedCount = 0;
          for (const folder of foldersToDelete) {
            const result = await deleteDocumentFolder(folder.id);
            if (!result.success) failedCount++;
          }
          for (const document of documentsToDelete) {
            const result = await deleteDocument(document.id);
            if (!result.success) failedCount++;
          }

          clearSelection();
          if (failedCount > 0) {
            const failedItemLabel =
              failedCount === 1 ? '1 Eintrag' : `${failedCount} Einträge`;
            showFeedback(
              'error',
              `${failedItemLabel} ${
                failedCount === 1 ? 'konnte' : 'konnten'
              } nicht gelöscht werden.`
            );
          }
          refreshDocuments();
        });
      },
    });
  }

  function handleBatchDelete() {
    openDeleteConfirmationForSelection({
      documentsToDelete: selectedDocuments,
      foldersToDelete: selectedFolders,
    });
  }

  function handleBatchRestore() {
    if (selectedDocuments.length === 0) return;

    startTransition(async () => {
      let failedCount = 0;
      for (const document of selectedDocuments) {
        const result = await restoreDocument(document.id);
        if (!result.success) failedCount++;
      }

      clearSelection();
      if (failedCount > 0) {
        showFeedback(
          'error',
          `${failedCount} Datei(en) konnten nicht wiederhergestellt werden.`
        );
      }
      refreshDocuments();
    });
  }

  function openBatchMoveSelectionDialog() {
    openMoveCopyDialogForSelection('move');
  }

  function openBatchCopySelectionDialog() {
    openMoveCopyDialogForSelection('copy');
  }
  function handleMoveItemsToFolder({
    selection,
    targetFolderId,
  }: {
    selection: DocumentTableDragSelection;
    targetFolderId: string | null;
  }) {
    if (!canDropSelectionIntoFolder(selection, targetFolderId)) return;
    moveSelectionIntoFolder(selection, targetFolderId);
  }

  function handleMoveItemsToTrash(selection: DocumentTableDragSelection) {
    const { documentsToUse, foldersToUse } = getSelectionItems(selection);
    setSelectedDocumentIds(new Set(selection.documentIds));
    setSelectedFolderIds(new Set(selection.folderIds));
    openDeleteConfirmationForSelection({
      documentsToDelete: documentsToUse,
      foldersToDelete: foldersToUse,
    });
  }

  function handlePointerDropTargetChange(
    target:
      | { kind: 'folder'; folderId: string | null }
      | { kind: 'trash' }
      | null
  ) {
    setIsTrashDragOver(target?.kind === 'trash');
    setBreadcrumbDropTargetId(
      target?.kind === 'folder' ? target.folderId ?? 'root' : null
    );
  }

  const primaryViewOptions: Array<{ value: DocumentLibraryView; label: string }> = [
    { value: 'folders', label: 'Dokumente' },
    { value: 'work', label: 'Verknüpfungen' },
    { value: 'all', label: 'Alle Dateien' },
  ];
  const categoryFilterOptions: Array<{
    value: DocumentLibraryCategoryFilter;
    label: string;
  }> = [
    { value: 'all', label: 'Alle Kategorien' },
    ...Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => ({
      value: value as DocumentCategory,
      label,
    })),
  ];
  const linkFilterOptions: Array<{
    value: DocumentLibraryLinkFilter;
    label: string;
  }> = [
    { value: 'all', label: 'Alle Verknüpfungen' },
    { value: 'jobs', label: 'Aufträge' },
    { value: 'projects', label: 'Projekte' },
    { value: 'clients', label: 'Kunden' },
    { value: 'employees', label: 'Mitarbeiter' },
    { value: 'unlinked', label: 'Nicht verknüpft' },
  ];

  function handleTrashDrop(event: DragEvent<HTMLButtonElement>) {
    if (!hasInternalRowDrag(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();
    setIsTrashDragOver(false);

    const selection = readInternalRowDragSelection(event.dataTransfer);
    if (!selection) return;

    const { documentsToUse, foldersToUse } = getSelectionItems(selection);
    setSelectedDocumentIds(new Set(selection.documentIds));
    setSelectedFolderIds(new Set(selection.folderIds));
    openDeleteConfirmationForSelection({
      documentsToDelete: documentsToUse,
      foldersToDelete: foldersToUse,
    });
  }

  function handleBreadcrumbDragOver(
    event: DragEvent<HTMLElement>,
    targetFolderId: string | null
  ) {
    if (!hasInternalRowDrag(event.dataTransfer)) return;
    event.preventDefault();

    const selection =
      readInternalRowDragSelection(event.dataTransfer) ?? draggedTableSelection;
    if (
      !selection ||
      !canDropSelectionIntoFolder(selection, targetFolderId, {
        disallowCurrentFolder: true,
      })
    ) {
      event.dataTransfer.dropEffect = 'none';
      setBreadcrumbDropTargetId(null);
      return;
    }

    event.dataTransfer.dropEffect = 'move';
    setBreadcrumbDropTargetId(targetFolderId ?? 'root');
  }

  function handleBreadcrumbDrop(
    event: DragEvent<HTMLElement>,
    targetFolderId: string | null
  ) {
    if (!hasInternalRowDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setBreadcrumbDropTargetId(null);

    const selection =
      readInternalRowDragSelection(event.dataTransfer) ?? draggedTableSelection;
    if (
      !selection ||
      !canDropSelectionIntoFolder(selection, targetFolderId, {
        disallowCurrentFolder: true,
      })
    ) {
      return;
    }

    moveSelectionIntoFolder(selection, targetFolderId);
  }

  return (
    <div
      className={cn(
        'flex min-h-[calc(100vh-3rem)] flex-col gap-4 rounded-lg p-2 transition-colors',
        isDragActive &&
          'bg-primary/5 outline-1 outline-offset-4 outline-dashed outline-primary/80'
      )}
      onDragOver={(event) => {
        if (isTrashView) return;
        if (hasInternalRowDrag(event.dataTransfer)) {
          event.preventDefault();
          return;
        }
        if (!hasExternalFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Dokumente</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organisiere Dateien, Bilder, Verträge und Auftragsdokumente an einem Ort.
          </p>
        </div>

        {!isTrashView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                disabled={isPending || isNavigationPending}
                className="sm:mt-1"
              >
                <Plus className="size-4" />
                Hochladen oder Erstellen
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => openCreateFolderDialog(currentFolderId)}>
                <FolderPlus className="size-4" />
                Neuer Ordner
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" />
                Dateien hochladen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                <Folder className="size-4" />
                Ordner hochladen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => handleFolderInput(event.target.files)}
          {...{ webkitdirectory: '', directory: '' }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => handleUpload(event.target.files)}
        />
      </header>

      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
      <DocumentOperationBanner operation={operationBanner} />

      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {primaryViewOptions.map((option) => (
              <Button
                key={option.value}
                asChild
                size="sm"
                variant={visibleView === option.value ? 'secondary' : 'outline'}
                className="min-w-32"
              >
                <Link
                  href={getViewHref({
                    view: option.value,
                    searchQuery,
                    category,
                    linkFilter,
                  })}
                  onClick={(event) => {
                    if (shouldUseDefaultLinkBehavior(event)) return;
                    event.preventDefault();
                    navigateToDocumentLocation({
                      href: getViewHref({
                        view: option.value,
                        searchQuery,
                        category,
                        linkFilter,
                      }),
                      targetView: option.value,
                      targetFolderId: null,
                    });
                  }}
                >
                  {option.label}
                </Link>
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={visibleView === 'trash' ? 'secondary' : 'outline'}
              data-document-trash-drop="true"
              className={cn(
                'min-w-32',
                isTrashDragOver &&
                  'border-destructive text-destructive ring-2 ring-destructive/30'
              )}
              onClick={() => {
                navigateToDocumentLocation({
                  href: getViewHref({
                    view: 'trash',
                    searchQuery,
                  }),
                  targetView: 'trash',
                  targetFolderId: null,
                });
              }}
              onDragOver={(event) => {
                if (!hasInternalRowDrag(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setIsTrashDragOver(true);
              }}
              onDragEnter={(event) => {
                if (!hasInternalRowDrag(event.dataTransfer)) return;
                event.preventDefault();
                setIsTrashDragOver(true);
              }}
              onDragLeave={() => setIsTrashDragOver(false)}
              onDrop={handleTrashDrop}
            >
              <Trash2 className="size-4" />
              Papierkorb
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending || isNavigationPending}
                >
                  <MoreHorizontal className="size-4" />
                  Weitere Aktionen
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openCleanupDialog}>
                  <Settings2 className="size-4" />
                  Speicher prüfen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
          <form
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3"
            onSubmit={(event) => {
              event.preventDefault();
              updateSearch();
            }}
          >
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Dokumente suchen..."
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </form>

          {selectedItemCount > 0 && !isWorkView && (
            <div className="flex h-9 shrink-0 items-center gap-2 text-sm">
              <div className="flex h-9 items-center gap-1 rounded-full border bg-muted/50 px-2 text-muted-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  onClick={clearSelection}
                >
                  <X className="size-4" />
                  <span className="sr-only">Auswahl aufheben</span>
                </Button>
                <span className="whitespace-nowrap font-medium text-foreground">
                  {selectedItemCount} ausgewählt
                </span>
              </div>
              {isTrashView ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-9 rounded-md"
                  onClick={handleBatchRestore}
                  disabled={isPending || selectedDocuments.length === 0}
                >
                  <Undo2 className="size-4" />
                  <span className="sr-only">Wiederherstellen</span>
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-9 rounded-md"
                    onClick={openBatchMoveSelectionDialog}
                    disabled={isPending}
                  >
                    <MoveRight className="size-4" />
                    <span className="sr-only">Verschieben</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-9 rounded-md"
                    onClick={openBatchCopySelectionDialog}
                    disabled={isPending}
                  >
                    <Copy className="size-4" />
                    <span className="sr-only">Kopieren</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-9 rounded-md text-destructive hover:text-destructive"
                    onClick={handleBatchDelete}
                    disabled={isPending}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Löschen</span>
                  </Button>
                </>
              )}
            </div>
          )}

          <Button
            type="button"
            variant={filterPanelOpen ? 'secondary' : 'outline'}
            onClick={() => setFilterPanelOpen((current) => !current)}
            className="h-9 shrink-0"
          >
            <SlidersHorizontal className="size-4" />
            <span className="hidden sm:inline">Filter</span>
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {filterPanelOpen && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">Kategorie</Label>
                <Select
                  value={category}
                  onValueChange={(value) =>
                    updateSearch({
                      nextCategory: value as DocumentLibraryCategoryFilter,
                    })
                  }
                  disabled={visibleView !== 'all'}
                >
                  <SelectTrigger className="h-9 text-sm" aria-label="Kategorie filtern">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryFilterOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Verknüpfung</Label>
                <Select
                  value={linkFilter}
                  onValueChange={(value) =>
                    updateSearch({
                      nextLinkFilter: value as DocumentLibraryLinkFilter,
                    })
                  }
                  disabled={visibleView !== 'all'}
                >
                  <SelectTrigger className="h-9 text-sm" aria-label="Verknüpfung filtern">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {linkFilterOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {visibleView !== 'all' && (
              <p className="mt-2 text-xs text-muted-foreground">
                Kategorie- und Verknüpfungsfilter sind in „Alle Dateien“ verfügbar.
              </p>
            )}
          </div>
        )}
      </div>

      {visibleView === 'folders' && (
        <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link
            href="/dokumente?view=folders"
            data-document-breadcrumb-folder-drop-id="root"
            className={cn(
              'rounded border border-transparent px-2 py-1 transition-colors hover:bg-accent hover:text-foreground',
              !currentFolderId && 'bg-accent text-foreground cursor-not-allowed',
              breadcrumbDropTargetId === 'root' &&
                'border-primary bg-primary/10 text-foreground'
            )}
            onClick={(event) => {
              if (shouldUseDefaultLinkBehavior(event)) return;
              event.preventDefault();
              navigateToFolder(null);
            }}
            onDragOver={(event) => handleBreadcrumbDragOver(event, null)}
            onDragEnter={(event) => handleBreadcrumbDragOver(event, null)}
            onDragLeave={() => setBreadcrumbDropTargetId(null)}
            onDrop={(event) => handleBreadcrumbDrop(event, null)}
          >
            Dokumente
          </Link>
          {breadcrumbs.map((folder) => (
            <span key={folder.id} className="flex items-center gap-1">
              <span>/</span>
              <Link
                href={getFolderHref(folder.id)}
                data-document-breadcrumb-folder-drop-id={folder.id}
                className={cn(
                  'rounded border border-transparent px-2 py-1 transition-colors hover:bg-accent hover:text-foreground',
                  currentFolderId === folder.id &&
                    'bg-accent text-foreground cursor-not-allowed',
                  breadcrumbDropTargetId === folder.id &&
                    'border-primary bg-primary/10 text-foreground'
                )}
                onClick={(event) => {
                  if (shouldUseDefaultLinkBehavior(event)) return;
                  event.preventDefault();
                  navigateToFolder(folder.id);
                }}
                onDragOver={(event) => handleBreadcrumbDragOver(event, folder.id)}
                onDragEnter={(event) => handleBreadcrumbDragOver(event, folder.id)}
                onDragLeave={() => setBreadcrumbDropTargetId(null)}
                onDrop={(event) => handleBreadcrumbDrop(event, folder.id)}
              >
                {folder.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      {showNavigationSkeleton ? (
        <DokumenteTabContentSkeleton
          view={
            pendingNavigation?.view === 'work'
              ? 'work'
              : pendingNavigation?.view === 'all'
                ? 'all'
                : pendingNavigation?.view === 'trash'
                  ? 'trash'
                  : 'folders'
          }
        />
      ) : isWorkView ? (
        <DocumentWorkContextView
          documents={documents}
          jobs={jobs}
          projects={projects}
          clients={clients}
          employees={employees}
          isPending={isPending}
          onOpenDocument={openDocumentViewer}
          onDetailsDocument={openDetailsDialog}
          onRenameDocument={openRenameDocumentDialog}
          onLinkDocument={openLinkDialog}
          onMoveDocument={(document) =>
            openMoveCopyDialog({ kind: 'document', document }, 'move')
          }
          onCopyDocument={(document) =>
            openMoveCopyDialog({ kind: 'document', document }, 'copy')
          }
          onDeleteDocument={handleDeleteDocument}
        />
      ) : (
        <>
      <div className="space-y-2 md:hidden">
        {folders.map((folder) => {
          const handlers = {
            onOpen: () => navigateToFolder(folder.id),
            onMove: () => openMoveCopyDialog({ kind: 'folder', folder }, 'move'),
            onCopy: () => openMoveCopyDialog({ kind: 'folder', folder }, 'copy'),
            onRename: () => openRenameFolderDialog(folder),
            onDelete: () => handleDeleteFolder(folder),
          };

          return (
            <ContextMenu key={folder.id} modal={false}>
              <ContextMenuTrigger asChild>
                <div
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50"
                  onClick={() => navigateToFolder(folder.id)}
                >
                  <div
                    className="shrink-0"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedFolderIds.has(folder.id)}
                      onCheckedChange={() => toggleFolderSelection(folder.id)}
                      aria-label={`Ordner ${folder.name} auswählen`}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{folder.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Ordner · {formatDate(folder.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div onClick={(event) => event.stopPropagation()}>
                    <FolderActionsMenu
                      folder={folder}
                      disabled={isPending}
                      handlers={handlers}
                    />
                  </div>
                </div>
              </ContextMenuTrigger>
              <FolderContextMenuContent folder={folder} handlers={handlers} />
            </ContextMenu>
          );
        })}

        {documents.map((document) => {
          const FileIcon = getFileIcon(document);
          const linkBadges = getLinkBadges(document);
          const handlers = {
            onOpen: () => openDocumentViewer(document),
            onDetails: () => openDetailsDialog(document),
            onRename: () => openRenameDocumentDialog(document),
            onLink: () => openLinkDialog(document),
            onMove: () => openMoveCopyDialog({ kind: 'document', document }, 'move'),
            onCopy: () => openMoveCopyDialog({ kind: 'document', document }, 'copy'),
            onDelete: () => handleDeleteDocument(document),
            onRestore: () => handleRestoreDocument(document),
            onPermanentDelete: () => handlePermanentDeleteDocument(document),
          };

          return (
            <ContextMenu key={document.id} modal={false}>
              <ContextMenuTrigger asChild>
                <div
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50"
                  onClick={() => openDocumentViewer(document)}
                >
                  <div
                    className="shrink-0"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedDocumentIds.has(document.id)}
                      onCheckedChange={() => toggleDocumentSelection(document.id)}
                      aria-label={`Datei ${document.displayName} auswählen`}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {document.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {DOCUMENT_CATEGORY_LABELS[document.category]} ·{' '}
                        {formatFileSize(document.sizeBytes)} ·{' '}
                        {formatDate(document.updatedAt)}
                      </p>
                      {linkBadges.length > 0 && (
                        <p className="truncate text-xs text-muted-foreground">
                          {linkBadges[0]}
                          {linkBadges.length > 1 ? ` +${linkBadges.length - 1}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <div onClick={(event) => event.stopPropagation()}>
                    <DocumentActionsMenu
                      document={document}
                      isTrashView={isTrashView}
                      disabled={isPending}
                      handlers={handlers}
                    />
                  </div>
                </div>
              </ContextMenuTrigger>
              <DocumentContextMenuContent
                document={document}
                isTrashView={isTrashView}
                handlers={handlers}
              />
            </ContextMenu>
          );
        })}

        {folders.length === 0 && documents.length === 0 && (
          <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
            Noch keine Dokumente gefunden.
          </div>
        )}
      </div>

      <DocumentLibraryTable
        folders={folders}
        documents={documents}
        selectedFolderIds={selectedFolderIds}
        selectedDocumentIds={selectedDocumentIds}
        isTrashView={isTrashView}
        isPending={isPending}
        onOpenFolder={(folder) => navigateToFolder(folder.id)}
        onOpenDocument={openDocumentViewer}
        onRenameFolder={openRenameFolderDialog}
        onMoveFolder={(folder) => openMoveCopyDialog({ kind: 'folder', folder }, 'move')}
        onCopyFolder={(folder) => openMoveCopyDialog({ kind: 'folder', folder }, 'copy')}
        onDeleteFolder={handleDeleteFolder}
        onDetailsDocument={openDetailsDialog}
        onRenameDocument={openRenameDocumentDialog}
        onLinkDocument={openLinkDialog}
        onMoveDocument={(document) =>
          openMoveCopyDialog({ kind: 'document', document }, 'move')
        }
        onCopyDocument={(document) =>
          openMoveCopyDialog({ kind: 'document', document }, 'copy')
        }
        onDeleteDocument={handleDeleteDocument}
        onRestoreDocument={handleRestoreDocument}
        onPermanentDeleteDocument={handlePermanentDeleteDocument}
        onToggleFolderSelection={toggleFolderSelection}
        onToggleDocumentSelection={toggleDocumentSelection}
        onSelectAllVisible={() => {
          setSelectedDocumentIds((current) => {
            const next = new Set(current);
            for (const document of documents) {
              next.add(document.id);
            }
            return next;
          });
          setSelectedFolderIds((current) => {
            const next = new Set(current);
            for (const folder of folders) {
              next.add(folder.id);
            }
            return next;
          });
        }}
        onClearSelection={clearSelection}
        onBatchMoveSelection={openBatchMoveSelectionDialog}
        onBatchCopySelection={openBatchCopySelectionDialog}
        onBatchDeleteSelection={handleBatchDelete}
        onRectangleSelectionChange={({ folderIds, documentIds }) => {
          setSelectedFolderIds(folderIds);
          setSelectedDocumentIds(documentIds);
        }}
        onRectangleSelectionComplete={() => {
          suppressNextSelectionClearRef.current = true;
          window.setTimeout(() => {
            suppressNextSelectionClearRef.current = false;
          }, 250);
        }}
        onDragSelectionStart={setDraggedTableSelection}
        onDragSelectionEnd={() => {
          setDraggedTableSelection(null);
          setIsTrashDragOver(false);
          setBreadcrumbDropTargetId(null);
        }}
        onMoveItemsToFolder={handleMoveItemsToFolder}
        onMoveItemsToTrash={handleMoveItemsToTrash}
        onPointerDropTargetChange={handlePointerDropTargetChange}
        canDropSelectionIntoFolder={canDropSelectionIntoFolder}
      />
        </>
      )}

      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        items={uploadItems}
        target={{ folderId: currentFolderId }}
        allowFolderCreation={view === 'folders'}
        onComplete={(failedCount) => {
          if (failedCount > 0) {
            showFeedback(
              'error',
              `${failedCount} Datei(en) konnten nicht hochgeladen werden.`
            );
          }
          if (fileInputRef.current) fileInputRef.current.value = '';
          if (folderInputRef.current) folderInputRef.current.value = '';
          refreshDocuments();
        }}
      />

      <DocumentViewerDialog
        document={viewerDocument}
        open={!!viewerDocument}
        onOpenChange={(open) => !open && setViewerDocument(null)}
      />

      <DocumentLinkDialog
        key={linkDialog?.id ?? 'closed-document-link-dialog'}
        document={linkDialog}
        open={!!linkDialog}
        onOpenChange={(open) => !open && setLinkDialog(null)}
        jobs={linkDialogCatalogIsPrefetched ? jobs : undefined}
        projects={linkDialogCatalogIsPrefetched ? projects : undefined}
        clients={linkDialogCatalogIsPrefetched ? clients : undefined}
        employees={linkDialogCatalogIsPrefetched ? employees : undefined}
        onComplete={(variant, message) => {
          showFeedback(variant, message);
          refreshDocuments();
        }}
      />

      <Dialog
        open={!!renameDialog}
        onOpenChange={(open) => !open && setRenameDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameDialog?.kind === 'folder'
                ? 'Ordner umbenennen'
                : 'Datei umbenennen'}
            </DialogTitle>
            <DialogDescription>
              Vergib einen klaren Namen, damit das Dokument später leicht gefunden wird.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={renameInputRef}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleRenameConfirm();
              }
            }}
            placeholder="Name"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameDialog(null)}
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
        open={!!confirmDialog}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const onConfirm = confirmDialog?.onConfirm;
                setConfirmDialog(null);
                onConfirm?.();
              }}
            >
              {confirmDialog?.confirmLabel ?? 'Bestätigen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={cleanupDialogOpen} onOpenChange={setCleanupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Speicher prüfen</DialogTitle>
            <DialogDescription>
              Prüft Metadaten und Supabase Storage auf fehlende oder verwaiste Dateien.
            </DialogDescription>
          </DialogHeader>
          {isCleanupLoading ? (
            <p className="text-sm text-muted-foreground">
              Speicherbericht wird erstellt...
            </p>
          ) : cleanupReport ? (
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-bold">
                    {cleanupReport.orphanedStoragePaths.length}
                  </p>
                  <p className="text-muted-foreground">Verwaiste Objekte</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-bold">
                    {cleanupReport.missingStoragePaths.length}
                  </p>
                  <p className="text-muted-foreground">Fehlende Objekte</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-bold">
                    {cleanupReport.deletedDocumentStoragePaths.length}
                  </p>
                  <p className="text-muted-foreground">Dateien im Papierkorb</p>
                </div>
              </div>
              {cleanupReport.orphanedStoragePaths.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-md border p-2 text-xs text-muted-foreground">
                  {cleanupReport.orphanedStoragePaths.map((path) => (
                    <p key={path} className="break-all">
                      {path}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch kein Speicherbericht geladen.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCleanupDialogOpen(false)}
            >
              Schließen
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteOrphanedObjects}
              disabled={
                isPending ||
                isCleanupLoading ||
                !cleanupReport?.orphanedStoragePaths.length
              }
            >
              Verwaiste Objekte löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={folderDialogOpen}
        onOpenChange={(open) => {
          setFolderDialogOpen(open);
          if (!open) setFolderDialogParentFolderId(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ordner erstellen</DialogTitle>
            <DialogDescription>
              Lege einen neuen Ordner im aktuellen Bereich an.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="Ordnername"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFolderDialogOpen(false)}
            >
              Abbrechen
            </Button>
            <Button type="button" onClick={handleCreateFolder} disabled={isPending}>
              Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoveDestinationDialog
        key={
          moveCopyDialog
            ? `${moveCopyDialog.mode}-${moveCopyDialog.sourceFolderId ?? 'root'}-${moveCopyDialog.documents.map((document) => document.id).join('-')}-${moveCopyDialog.folders.map((folder) => folder.id).join('-')}`
            : 'move-copy-closed'
        }
        open={!!moveCopyDialog}
        mode={moveCopyDialog?.mode ?? 'move'}
        title={moveCopyDialog?.mode === 'copy' ? 'Kopieren nach' : 'Verschieben nach'}
        description={
          moveCopyDialog &&
          moveCopyDialog.documents.length + moveCopyDialog.folders.length > 1
            ? 'Wähle den Zielordner für die ausgewählten Einträge.'
            : moveCopyDialog?.documents.length === 1
              ? `Wähle den Zielordner für „${moveCopyDialog.documents[0].displayName}“.`
              : moveCopyDialog?.folders.length === 1
                ? `Wähle den Zielordner für „${moveCopyDialog.folders[0].name}“.`
                : 'Wähle den Zielordner.'
        }
        allFolders={allFolders}
        visibleDocuments={documents}
        selectedDocuments={moveCopyDialog?.documents ?? []}
        selectedFolders={moveCopyDialog?.folders ?? []}
        sourceFolderId={moveCopyDialog?.sourceFolderId ?? null}
        isPending={isPending || isMoveCopySubmitting}
        onOpenChange={(open) => {
          if (!open && !isMoveCopySubmitting) setMoveCopyDialog(null);
        }}
        onConfirm={handleMoveCopyConfirm}
        onCreateFolder={openCreateFolderDialog}
        onOpenDocument={openDocumentViewer}
      />

      <Dialog
        open={!!detailsDialog}
        onOpenChange={(open) => !open && setDetailsDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dateidetails</DialogTitle>
            <DialogDescription>
              Metadaten und Verknüpfungen zu dieser Datei.
            </DialogDescription>
          </DialogHeader>
          {detailsDialog && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </p>
                <p className="mt-1 break-words font-medium">
                  {detailsDialog.displayName}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Originaldatei
                  </p>
                  <p className="mt-1 break-words">{detailsDialog.originalFileName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Typ
                  </p>
                  <p className="mt-1">
                    {getFileTypeLabel(detailsDialog)}
                    {detailsDialog.mimeType ? ` (${detailsDialog.mimeType})` : ''}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Kategorie
                  </p>
                  <select
                    value={detailsDialog.category}
                    onChange={(event) =>
                      handleUpdateCategory(
                        detailsDialog,
                        event.target.value as DocumentCategory
                      )
                    }
                    className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    disabled={isPending || isTrashView}
                  >
                    {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Größe
                  </p>
                  <p className="mt-1">{formatFileSize(detailsDialog.sizeBytes)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Hochgeladen am
                  </p>
                  <p className="mt-1">{formatDate(detailsDialog.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Hochgeladen von
                  </p>
                  <p className="mt-1">{getUploaderName(detailsDialog)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Speicherpfad
                  </p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {detailsDialog.storagePath}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Verknüpfungen
                </p>
                {getLinkBadges(detailsDialog).length === 0 ? (
                  <p className="mt-1 text-muted-foreground">
                    Keine Verknüpfung zu Auftrag, Projekt, Kunde oder Mitarbeiter.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {getLinkBadges(detailsDialog).map((badge) => (
                      <span
                        key={badge}
                        className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary-foreground"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Versionen
                  </p>
                  {!isTrashView &&
                    ['contract', 'invoice', 'offer', 'report'].includes(
                      detailsDialog.category
                    ) && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => versionInputRef.current?.click()}
                          disabled={isPending}
                        >
                          Neue Version
                        </Button>
                        <input
                          ref={versionInputRef}
                          type="file"
                          className="hidden"
                          onChange={(event) => handleVersionUpload(event.target.files)}
                        />
                      </>
                    )}
                </div>
                <div className="mt-2 rounded-md border">
                  <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                    <div>
                      <p className="font-medium">
                        Aktuelle Version {detailsDialog.currentVersionNumber}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {detailsDialog.originalFileName} ·{' '}
                        {formatFileSize(detailsDialog.sizeBytes)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(detailsDialog)}
                    >
                      <Download className="size-4" />
                      Download
                    </Button>
                  </div>
                  {isDetailsLoading ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      Versionen werden geladen...
                    </p>
                  ) : detailsData?.versions.length ? (
                    <div className="divide-y">
                      {detailsData.versions.map((version) => (
                        <div
                          key={version.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div>
                            <p className="font-medium">
                              Version {version.versionNumber}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {version.originalFileName} ·{' '}
                              {formatFileSize(version.sizeBytes)} ·{' '}
                              {formatDate(version.createdAt)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadVersion(version.id)}
                          >
                            <Download className="size-4" />
                            Download
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      Noch keine älteren Versionen vorhanden.
                    </p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Verlauf
                </p>
                {isDetailsLoading ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Verlauf wird geladen...
                  </p>
                ) : detailsData?.auditEvents.length ? (
                  <div className="mt-2 max-h-48 space-y-2 overflow-auto rounded-md border p-2">
                    {detailsData.auditEvents.map((event) => (
                      <div key={event.id} className="text-sm">
                        <p className="font-medium">
                          {getAuditEventLabel(event.eventType)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(event.createdAt)}
                          {event.actor?.email ? ` · ${event.actor.email}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Noch kein Verlauf vorhanden.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
