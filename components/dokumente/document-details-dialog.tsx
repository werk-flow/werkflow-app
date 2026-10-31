'use client';

import type { RefObject } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatFileSize } from '@/lib/documents/format';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type OrganizationDocument,
} from '@/lib/documents/types';
import { formatGermanDate as formatDate } from '@/lib/utils';
import {
  getAuditEventLabel,
  getFileTypeLabel,
  getLinkBadges,
  getUploaderName,
} from './document-library-file-labels';
import type { LoadedDocumentDetails } from './use-document-details-dialog';

type DocumentDetailsMetadataProps = {
  document: OrganizationDocument;
  categoryDisabled: boolean;
  onUpdateCategory: (document: OrganizationDocument, category: DocumentCategory) => void;
};

function DocumentDetailsMetadata({
  document,
  categoryDisabled,
  onUpdateCategory,
}: DocumentDetailsMetadataProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Originaldatei</p>
        <p className="mt-1 wrap-anywhere">{document.originalFileName}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Typ</p>
        <p className="mt-1">
          {getFileTypeLabel(document)}
          {document.mimeType ? ` (${document.mimeType})` : ''}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kategorie</p>
        <div className="mt-1">
          <Select
            value={document.category}
            onValueChange={(value) => {
              const category = DOCUMENT_CATEGORIES.find((candidate) => candidate === value);
              if (category) onUpdateCategory(document, category);
            }}
            disabled={categoryDisabled}
          >
            <SelectTrigger className="w-full" aria-label="Kategorie der Datei">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Größe</p>
        <p className="mt-1">{formatFileSize(document.sizeBytes)}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hochgeladen am</p>
        <p className="mt-1">{formatDate(document.createdAt)}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hochgeladen von</p>
        <p className="mt-1 wrap-anywhere">{getUploaderName(document)}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Speicherpfad</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">{document.storagePath}</p>
      </div>
    </div>
  );
}

function DocumentDetailsLinks({ document }: { document: OrganizationDocument }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verknüpfungen</p>
      {getLinkBadges(document).length === 0 ? (
        <EmptyState
          size="compact"
          className="mt-1"
          title="Keine Verknüpfung zu Auftrag, Projekt, Kunde oder Mitarbeiter."
        />
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {getLinkBadges(document).map((badge) => (
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
  );
}

type DocumentDetailsVersionsProps = {
  document: OrganizationDocument;
  details: LoadedDocumentDetails | null;
  isLoading: boolean;
  isBusy: boolean;
  isTrashView: boolean;
  isItemBusy: (id: string) => boolean;
  versionInputRef: RefObject<HTMLInputElement | null>;
  onDownload: (document: OrganizationDocument) => void;
  onVersionUpload: (files: FileList | null) => void;
  onDownloadVersion: (versionId: string) => void;
  onRetryDetails: () => void;
};

type DocumentDetailsVersionsHeaderProps = Pick<
  DocumentDetailsVersionsProps,
  'document' | 'isBusy' | 'isTrashView' | 'versionInputRef' | 'onVersionUpload'
>;

function DocumentDetailsVersionsHeader({
  document,
  isBusy,
  isTrashView,
  versionInputRef,
  onVersionUpload,
}: DocumentDetailsVersionsHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Versionen</p>
      {!isTrashView && ['contract', 'invoice', 'offer', 'report'].includes(document.category) && (
        <>
          <Button
            pending={isBusy}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => versionInputRef.current?.click()}
            disabled={isBusy}
          >
            Neue Version
          </Button>
          <input
            ref={versionInputRef}
            type="file"
            className="hidden"
            onChange={(event) => onVersionUpload(event.target.files)}
          />
        </>
      )}
    </div>
  );
}

type DocumentDetailsOlderVersionsProps = Pick<
  DocumentDetailsVersionsProps,
  'details' | 'isLoading' | 'isItemBusy' | 'onDownloadVersion' | 'onRetryDetails'
>;

function DocumentDetailsOlderVersions({
  details,
  isLoading,
  isItemBusy,
  onDownloadVersion,
  onRetryDetails,
}: DocumentDetailsOlderVersionsProps) {
  if (isLoading) {
    return (
      <div className="divide-y" role="status" aria-busy="true">
        <span className="sr-only">Versionen werden geladen.</span>
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="space-y-1.5 px-3 py-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (details?.versions.length) {
    return (
      <div className="divide-y">
        {details.versions.map((version) => (
          <div key={version.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 wrap-anywhere">
              <p className="font-medium">Version {version.versionNumber}</p>
              <p className="text-xs text-muted-foreground">
                {version.originalFileName} · {formatFileSize(version.sizeBytes)} ·{' '}
                {formatDate(version.createdAt)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDownloadVersion(version.id)}
              pending={isItemBusy(version.id)}
            >
              <Download className="size-4" />
              Download
            </Button>
          </div>
        ))}
      </div>
    );
  }
  if (details) {
    return (
      <EmptyState size="compact" className="px-3 py-2" title="Noch keine älteren Versionen vorhanden." />
    );
  }
  return (
    <SectionError className="m-2" onRetry={onRetryDetails}>
      Die Dateidetails konnten nicht geladen werden.
    </SectionError>
  );
}

function DocumentDetailsVersions({
  document,
  details,
  isLoading,
  isBusy,
  isTrashView,
  isItemBusy,
  versionInputRef,
  onDownload,
  onVersionUpload,
  onDownloadVersion,
  onRetryDetails,
}: DocumentDetailsVersionsProps) {
  return (
    <div>
      <DocumentDetailsVersionsHeader
        document={document}
        isBusy={isBusy}
        isTrashView={isTrashView}
        versionInputRef={versionInputRef}
        onVersionUpload={onVersionUpload}
      />
      <div className="mt-2 rounded-md border">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="min-w-0 wrap-anywhere">
            <p className="font-medium">Aktuelle Version {document.currentVersionNumber}</p>
            <p className="text-xs text-muted-foreground">
              {document.originalFileName} · {formatFileSize(document.sizeBytes)}
            </p>
          </div>
          <Button
            pending={isBusy}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDownload(document)}
            disabled={isBusy}
          >
            <Download className="size-4" />
            Download
          </Button>
        </div>
        <DocumentDetailsOlderVersions
          details={details}
          isLoading={isLoading}
          isItemBusy={isItemBusy}
          onDownloadVersion={onDownloadVersion}
          onRetryDetails={onRetryDetails}
        />
      </div>
    </div>
  );
}

type DocumentDetailsHistoryProps = {
  details: LoadedDocumentDetails | null;
  isLoading: boolean;
};

function DocumentDetailsHistory({ details, isLoading }: DocumentDetailsHistoryProps) {
  // A failed read shows its retry under „Versionen“, never an empty history.
  if (!isLoading && !details) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verlauf</p>
      {isLoading ? (
        <div className="mt-2 space-y-2 rounded-md border p-2" role="status" aria-busy="true">
          <span className="sr-only">Verlauf wird geladen.</span>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-1">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : details?.auditEvents.length ? (
        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
          {details.auditEvents.map((event) => (
            <div key={event.id} className="text-sm">
              <p className="font-medium">{getAuditEventLabel(event.eventType)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(event.createdAt)}
                {event.actor?.email ? ` · ${event.actor.email}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState size="compact" className="mt-1" title="Noch kein Verlauf vorhanden." />
      )}
    </div>
  );
}

type DocumentDetailsDialogProps = Omit<DocumentDetailsVersionsProps, 'document'> & {
  document: OrganizationDocument | null;
  error: string | null;
  onClose: () => void;
  onUpdateCategory: DocumentDetailsMetadataProps['onUpdateCategory'];
};

/** „Dateidetails": metadata, links, versions and audit history of one document. */
export function DocumentDetailsDialog({
  document,
  error,
  onClose,
  onUpdateCategory,
  ...versionProps
}: DocumentDetailsDialogProps) {
  return (
    <Dialog
      open={!!document}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
      pending={versionProps.isBusy}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dateidetails</DialogTitle>
          <DialogDescription>Metadaten und Verknüpfungen zu dieser Datei.</DialogDescription>
        </DialogHeader>
        <ErrorText>{error}</ErrorText>
        {document && (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</p>
              <p className="mt-1 break-words font-medium">{document.displayName}</p>
            </div>
            <DocumentDetailsMetadata
              document={document}
              categoryDisabled={versionProps.isBusy || versionProps.isTrashView}
              onUpdateCategory={onUpdateCategory}
            />
            <DocumentDetailsLinks document={document} />
            <DocumentDetailsVersions document={document} {...versionProps} />
            <DocumentDetailsHistory details={versionProps.details} isLoading={versionProps.isLoading} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
