function trimStorageName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function sanitizeDocumentStorageFileName(fileName: string): string {
  const trimmed = trimStorageName(fileName) || 'document';
  return (
    trimmed
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 140)
      .replace(/^[-.]+|[-.]+$/g, '') || 'document'
  );
}

export function buildDocumentStoragePath(input: {
  organizationId: string;
  documentId: string;
  fileName: string;
}): string {
  return `${input.organizationId}/${input.documentId}/${sanitizeDocumentStorageFileName(input.fileName)}`;
}

/**
 * The folder of one version upload: its ticket's staging key and every copy a
 * finalize promotes from it lie inside, and no other upload's do.
 */
export function buildDocumentVersionUploadFolder(input: {
  organizationId: string;
  documentId: string;
  uploadId: string;
}): string {
  return `${input.organizationId}/${input.documentId}/versions/${input.uploadId}`;
}

export function buildDocumentVersionStoragePath(input: {
  organizationId: string;
  documentId: string;
  uploadId: string;
  versionNumber: number;
  fileName: string;
}): string {
  return `${buildDocumentVersionUploadFolder(input)}/${input.versionNumber}-${sanitizeDocumentStorageFileName(input.fileName)}`;
}

/**
 * The key an upload ticket signs for `path`: the path with a folder of the
 * person whose session created the ticket before its file name. Finalize
 * recomputes it from its own session, so another person, of the same
 * organization or another, finds no staged object there and never registers,
 * copies or discards the creator's bytes.
 */
export function bindUploadPathToCreator(path: string, creatorId: string): string {
  const nameStart = path.lastIndexOf('/') + 1;
  return `${path.slice(0, nameStart)}${creatorId}/${path.slice(nameStart)}`;
}
