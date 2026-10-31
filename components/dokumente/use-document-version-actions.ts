'use client';

import { useRef } from 'react';

import {
  getDocumentDetails,
  getDocumentSignedUrl,
  getDocumentVersionSignedUrl,
} from '@/lib/documents/actions';
import type { DocumentVersion, OrganizationDocument, SignedDocumentUrlResult } from '@/lib/documents/types';
import { uploadDocumentVersionDirect } from '@/lib/documents/upload-client';
import type { DocumentDetailsDialogState } from './use-document-details-dialog';
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

/**
 * The file actions of the „Dateidetails" dialog: download, upload of a new
 * version and download of an older one. The button spins under the row's busy
 * id and failures render inside the dialog.
 */
export function useDocumentVersionActions({
  details,
  mutations,
}: {
  details: DocumentDetailsDialogState;
  mutations: DocumentLibraryMutations;
}) {
  const { busy, showFeedback } = mutations;
  const { detailsDialog, detailsDialogIdRef, setIsDetailsLoading, setDetailsError } = details;
  const versionInputRef = useRef<HTMLInputElement>(null);

  function handleDownload(document: OrganizationDocument) {
    openSignedUrl({
      busy,
      busyId: document.id,
      readSignedUrl: () => getDocumentSignedUrl(document.id),
      failure: 'Die Datei konnte nicht geöffnet werden.',
      setDetailsError,
    });
  }

  function handleVersionUpload(files: FileList | null) {
    if (!detailsDialog || !files?.[0]) return;

    const file = files[0];
    const activeDocument = detailsDialog;
    const documentId = activeDocument.id;
    const uploadFailure = 'Die neue Version konnte nicht hochgeladen werden.';
    setDetailsError(null);

    void busy
      .run(documentId, async () => {
        const result = await uploadDocumentVersionDirect({
          documentId,
          file,
        });

        if (!result.success) {
          if (detailsDialogIdRef.current === documentId) {
            setDetailsError(uploadFailure);
          }
          return;
        }

        showFeedback('success', 'Neue Version wurde hochgeladen.');
        await showUploadedVersion({ details, activeDocument, version: result.version });
      })
      .catch(() => {
        if (detailsDialogIdRef.current === documentId) {
          setDetailsError(uploadFailure);
          setIsDetailsLoading(false);
        }
      })
      .finally(() => {
        if (versionInputRef.current) versionInputRef.current.value = '';
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
    versionInputRef,
    handleDownload,
    handleVersionUpload,
    handleDownloadVersion,
  };
}
