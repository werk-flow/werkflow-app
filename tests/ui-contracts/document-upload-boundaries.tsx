import { useState } from 'react';

import { DocumentBatchUploadDialog } from '@/components/dokumente/document-upload-dialog';
import { uploadDocumentVersionDirect } from '@/lib/documents/upload-client';
import type { DocumentUploadItem } from '@/components/dokumente/document-upload-rows';
import type { OrganizationDocument } from '@/lib/documents/types';

// The document upload's Server Actions for the upload dialog contract. The
// real upload client runs; the spec answers the storage PUTs. A finalize
// registers each document id once, like `finalize_document_upload`.

type UploadActions = typeof import('@/lib/documents/upload-actions');
type FolderActions = typeof import('@/lib/documents/folder-actions');
type SignatureActions = typeof import('@/lib/work-artifacts/signature-upload-actions');
type PersonnelActions = typeof import('@/lib/personnel/lifecycle-actions');

type DocumentUploadBoundaryState = {
  /** File names whose finalize registers the document, but whose answer never reaches the browser, once each. */
  loseFinalizeAnswer: string[];
  /** The file name of each issued upload ticket. */
  tickets: string[];
  /** The file name of each registered document. */
  registered: string[];
  /** What the dialog reported after each run. */
  completions: { failedCount: number; uploaded: string[] }[];
  /** File names whose next finalize fails before it registers anything, once each. */
  failFinalize: string[];
  /** The versions saved on the versioned document, the first one included. */
  versions: { versionNumber: number; storagePath: string }[];
};

declare global {
  interface Window {
    uiContractDocumentUpload: DocumentUploadBoundaryState;
    /** The real version upload of the upload client, for the version retry contracts. */
    uiContractUploadVersion: typeof uploadDocumentVersionDirect;
  }
}

/** Takes the file name out of a once-only list; true when it was there. */
function takeOnce(list: string[], fileName: string): boolean {
  const index = list.indexOf(fileName);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

const registeredDocumentIds = new Set<string>();
let ticketCount = 0;

function unexpectedDocumentAction(): never {
  throw new Error('This document action is outside the upload dialog contract.');
}

function contractDocument(documentId: string, fileName: string): OrganizationDocument {
  return {
    id: documentId,
    organizationId: 'contract-organization',
    folderId: null,
    category: 'other',
    storageBucket: 'contract-bucket',
    storagePath: `contract-organization/${documentId}/${fileName}`,
    originalFileName: fileName,
    displayName: fileName,
    mimeType: 'application/pdf',
    sizeBytes: 64,
    uploadedBy: 'contract-user',
    copiedFromDocumentId: null,
    currentVersionNumber: 1,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    metadata: {},
    createdAt: '2026-11-02T08:00:00.000Z',
    updatedAt: '2026-11-02T08:00:00.000Z',
    uploader: null,
    links: [],
    archive: null,
  };
}

export async function createDocumentUploadTicket(
  input: Parameters<UploadActions['createDocumentUploadTicket']>[0],
): ReturnType<UploadActions['createDocumentUploadTicket']> {
  ticketCount += 1;
  const documentId = `contract-document-${ticketCount}`;
  window.uiContractDocumentUpload.tickets.push(input.fileName);
  return {
    success: true,
    ticket: {
      documentId,
      storagePath: `contract-organization/staging/${documentId}`,
      uploadUrl: `http://localhost/storage/${documentId}/${encodeURIComponent(input.fileName)}`,
    },
  };
}

export async function finalizeDocumentUpload(
  input: Parameters<UploadActions['finalizeDocumentUpload']>[0],
): ReturnType<UploadActions['finalizeDocumentUpload']> {
  const state = window.uiContractDocumentUpload;
  if (registeredDocumentIds.has(input.documentId)) return { success: false, error: 'already_finalized' };
  registeredDocumentIds.add(input.documentId);
  state.registered.push(input.fileName);
  if (takeOnce(state.loseFinalizeAnswer, input.fileName)) throw new TypeError('Failed to fetch');
  return { success: true, document: contractDocument(input.documentId, input.fileName) };
}

function versionPath(documentId: string, versionNumber: number, fileName: string): string {
  return `contract-organization/${documentId}/v${versionNumber}/${fileName}`;
}

function currentVersion(): { versionNumber: number; storagePath: string } {
  const current = window.uiContractDocumentUpload.versions.at(-1);
  if (!current) throw new Error('The versioned contract document needs its first version.');
  return current;
}

export async function createDocumentVersionUploadTicket(
  input: Parameters<UploadActions['createDocumentVersionUploadTicket']>[0],
): ReturnType<UploadActions['createDocumentVersionUploadTicket']> {
  const versionNumber = currentVersion().versionNumber + 1;
  const storagePath = versionPath(input.documentId, versionNumber, input.fileName);
  return {
    success: true,
    ticket: {
      documentId: input.documentId,
      versionNumber,
      storagePath,
      uploadUrl: `http://localhost/storage/${input.documentId}/${encodeURIComponent(input.fileName)}`,
    },
  };
}

/** Saves a version when its number is the next one, like `finalize_document_version_upload`. */
export async function finalizeDocumentVersionUpload(
  input: Parameters<UploadActions['finalizeDocumentVersionUpload']>[0],
): ReturnType<UploadActions['finalizeDocumentVersionUpload']> {
  const state = window.uiContractDocumentUpload;
  if (takeOnce(state.failFinalize, input.fileName)) return { success: false, error: 'load_failed' };
  if (input.versionNumber !== currentVersion().versionNumber + 1) {
    return { success: false, error: 'version_conflict' };
  }
  const storagePath = versionPath(input.documentId, input.versionNumber, input.fileName);
  state.versions.push({ versionNumber: input.versionNumber, storagePath });
  if (takeOnce(state.loseFinalizeAnswer, input.fileName)) throw new TypeError('Failed to fetch');
  const { originalFileName, ...document } = contractDocument(input.documentId, input.fileName);
  return {
    success: true,
    version: {
      ...document,
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      storagePath,
      originalFileName,
    },
  };
}

export const createDocumentFolder: FolderActions['createDocumentFolder'] = unexpectedDocumentAction;
export const createWorkArtifactSignatureUploadTicket: SignatureActions['createWorkArtifactSignatureUploadTicket'] =
  unexpectedDocumentAction;
export const createPersonnelDocumentUploadTicket: PersonnelActions['createPersonnelDocumentUploadTicket'] =
  unexpectedDocumentAction;
export const finalizePersonnelDocumentUpload: PersonnelActions['finalizePersonnelDocumentUpload'] =
  unexpectedDocumentAction;
export const cleanupPersonnelDocumentUpload: PersonnelActions['cleanupPersonnelDocumentUpload'] =
  unexpectedDocumentAction;

window.uiContractUploadVersion = uploadDocumentVersionDirect;

const CONTRACT_FILE_NAMES = ['angebot.pdf', 'aufmass.pdf', 'abnahme.pdf'];

/** The library upload dialog with three chosen files. */
export function DocumentUploadContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [items] = useState<DocumentUploadItem[]>(() =>
    CONTRACT_FILE_NAMES.map((name, index) => ({
      id: `contract-upload-${index}`,
      file: new File([`Inhalt von ${name}`], name, { type: 'application/pdf' }),
    })),
  );
  return (
    <main>
      <output aria-label="Upload-Dialog">{open ? 'offen' : 'geschlossen'}</output>
      <DocumentBatchUploadDialog
        open={open}
        onOpenChange={setOpen}
        items={items}
        target={{ kind: 'library', folderId: null }}
        onComplete={(failedCount, uploadedDocuments) => {
          window.uiContractDocumentUpload.completions.push({
            failedCount,
            uploaded: uploadedDocuments.map((document) => document.originalFileName),
          });
        }}
      />
    </main>
  );
}
