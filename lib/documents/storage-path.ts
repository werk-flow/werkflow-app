function trimStorageName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function sanitizeDocumentStorageFileName(fileName: string): string {
  const trimmed = trimStorageName(fileName) || "document";
  return (
    trimmed
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 140)
      .replace(/^[-.]+|[-.]+$/g, "") || "document"
  );
}

export function buildDocumentStoragePath(input: {
  organizationId: string;
  documentId: string;
  fileName: string;
}): string {
  return `${input.organizationId}/${input.documentId}/${sanitizeDocumentStorageFileName(input.fileName)}`;
}

export function buildDocumentVersionStoragePath(input: {
  organizationId: string;
  documentId: string;
  versionNumber: number;
  fileName: string;
}): string {
  return `${input.organizationId}/${input.documentId}/versions/${input.versionNumber}-${sanitizeDocumentStorageFileName(input.fileName)}`;
}
