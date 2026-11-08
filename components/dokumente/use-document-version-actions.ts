'use client';

import { useRef, useState } from 'react';

import {
  getDocumentDetails,
  getDocumentSignedUrl,
  getDocumentVersionSignedUrl,
} from '@/lib/documents/actions';
import type { DocumentVersion, OrganizationDocument, SignedDocumentUrlResult } from '@/lib/documents/types';
import { uploadDocumentVersionDirect, type UploadFailureReason } from '@/lib/documents/upload-client';
import type { DocumentDetailsDialogState } from './use-document-details-dialog';
import { failedUploadRow, isRetryableUploadRow, type DocumentUploadRow } from './document-upload-rows';
import type { DocumentLibraryMutations } from './use-document-library-mutations';

/** Opens a signed URL in a new tab under the busy id; a failure renders inside the dialog. */
function openSignedUrl({
  busy,
  busyId,
  readSignedUrl,
  failure,
  setDetailsError,
}: {
  busy: DocumentLibraryMutations['busy'];
  busyId: string;
  readSignedUrl: () => Promise<SignedDocumentUrlResult>;
  failure: string;
  setDetailsError: DocumentDetailsDialogState['setDetailsError'];
}): void {
  setDetailsError(null);
  void busy
    .run(busyId, async () => {
      const result = await readSignedUrl();
      if (!result.success) {
        setDetailsError(failure);
        return;
      }
      window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
    })
    .catch(() => setDetailsError(failure));
}

/** Shows an uploaded version in the dialog, when it still shows that document, and reloads its details. */
async function showUploadedVersion({
  details,
  activeDocument,
  version,
}: {
  details: DocumentDetailsDialogState;
  activeDocument: OrganizationDocument;
  version: DocumentVersion;
}): Promise<void> {
  const { setDetailsDialog, detailsDialogIdRef, setDetailsData, setIsDetailsLoading } = details;
  const documentId = activeDocument.id;
  if (detailsDialogIdRef.current !== documentId) return;
  const refreshedDocument = {
    ...activeDocument,
    currentVersionNumber: version.versionNumber,
    storagePath: version.storagePath,
    originalFileName: version.originalFileName,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
    uploadedBy: version.uploadedBy,
    updatedAt: version.createdAt,
    uploader: version.uploader,
  };
  setDetailsDialog(refreshedDocument);
  setDetailsData(null);
  setIsDetailsLoading(true);
  // The upload is saved: a failed reload reports the details, never the upload.
  const detailsResult = await getDocumentDetails(documentId).catch(() => null);
  if (detailsDialogIdRef.current === documentId) {
    // A failed reload leaves `detailsData` empty; the dialog shows it with a retry.
    if (detailsResult?.success) {
      setDetailsData({
        ...detailsResult,
        document: refreshedDocument,
      });
    }
    setIsDetailsLoading(false);
  }
}

/** The document changed under the upload, so the details reload to show its versions or its filing. */
function meetsChangedDocument(reason: UploadFailureReason): boolean {
  return reason === 'version_conflict' || reason === 'version_unconfirmed' || reason === 'document_filed';
}

type VersionUpload = { document: OrganizationDocument; row: DocumentUploadRow };

/**
 * The upload of a new version. The upload dialog lists its file and keeps a
 * failed upload with its reason and a retry; a cancel stops the transfer.
 */
function useVersionUpload({
  details,
  mutations,
}: {
  details: DocumentDetailsDialogState;
  mutations: DocumentLibraryMutations;
}) {
  const { busy, showFeedback } = mutations;
  const { detailsDialogIdRef, setIsDetailsLoading, setDetailsError } = details;
  const versionInputRef = useRef<HTMLInputElement>(null);
  const uploadIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [versionUpload, setVersionUpload] = useState<VersionUpload | null>(null);

  function updateVersionRow(rowId: string, update: Partial<DocumentUploadRow>) {
    setVersionUpload((current) =>
      current?.row.id === rowId ? { ...current, row: { ...current.row, ...update } } : current,
    );
  }

  /** Reloads the dialog's details when it still shows the document, so its versions are current. */
  function reloadDetails(activeDocument: OrganizationDocument) {
    if (detailsDialogIdRef.current === activeDocument.id) details.openDetailsDialog(activeDocument);
  }

  function runVersionUpload(activeDocument: OrganizationDocument, row: DocumentUploadRow) {
    const controller = new AbortController();
    abortRef.current = controller;
    updateVersionRow(row.id, { status: 'uploading', progress: 0, failure: undefined });

    void busy
      .run(activeDocument.id, async () => {
        const outcome = await uploadDocumentVersionDirect({
          documentId: activeDocument.id,
          file: row.file,
          transferred: row.transferred,
          onProgress: (fraction) => updateVersionRow(row.id, { progress: fraction }),
          signal: controller.signal,
        });

        if (outcome.status === 'failed') {
          updateVersionRow(row.id, failedUploadRow(outcome.reason, outcome.transferred));
          if (meetsChangedDocument(outcome.reason)) reloadDetails(activeDocument);
          return;
        }

        setVersionUpload((current) => (current?.row.id === row.id ? null : current));
        showFeedback('success', 'Neue Version wurde hochgeladen.');
        if (outcome.saved) await showUploadedVersion({ details, activeDocument, version: outcome.saved });
        else reloadDetails(activeDocument);
      })
      .catch(() => {
        if (detailsDialogIdRef.current === activeDocument.id) setIsDetailsLoading(false);
      });
  }

  function handleVersionUpload(files: FileList | null) {
    const file = files?.[0];
    if (!details.detailsDialog || !file) return;

    uploadIdRef.current += 1;
    const row: DocumentUploadRow = {
      id: `version-upload-${uploadIdRef.current}`,
      file,
      status: 'queued',
      transferred: null,
    };
    setDetailsError(null);
    setVersionUpload({ document: details.detailsDialog, row });
    runVersionUpload(details.detailsDialog, row);
    if (versionInputRef.current) versionInputRef.current.value = '';
  }

  return {
    versionInputRef,
    versionUpload,
    handleVersionUpload,
    retryVersionUpload: () => {
      if (versionUpload && isRetryableUploadRow(versionUpload.row)) {
        runVersionUpload(versionUpload.document, versionUpload.row);
      }
    },
    cancelVersionUpload: () => {
      abortRef.current?.abort();
      setVersionUpload(null);
    },
    closeVersionUpload: () => setVersionUpload(null),
  };
}

/**
 * The file actions of the „Dateidetails" dialog: download, upload of a new
 * version and download of an older one. Downloads spin under the row's busy
 * id and their failures render inside the dialog.
 */
export function useDocumentVersionActions({
  details,
  mutations,
}: {
  details: DocumentDetailsDialogState;
  mutations: DocumentLibraryMutations;
}) {
  const { busy } = mutations;
  const { setDetailsError } = details;
  const versionUpload = useVersionUpload({ details, mutations });

  function handleDownload(document: OrganizationDocument) {
    openSignedUrl({
      busy,
      busyId: document.id,
      readSignedUrl: () => getDocumentSignedUrl(document.id),
      failure: 'Die Datei konnte nicht geöffnet werden.',
      setDetailsError,
    });
  }

  function handleDownloadVersion(versionId: string) {
    openSignedUrl({
      busy,
      busyId: versionId,
      readSignedUrl: () =>
        getDocumentVersionSignedUrl(versionId, {
          download: true,
        }),
      failure: 'Die Version konnte nicht geöffnet werden.',
      setDetailsError,
    });
  }

  return {
    ...versionUpload,
    handleDownload,
    handleDownloadVersion,
  };
}
