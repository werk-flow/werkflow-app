// The type and size rule of a browser upload, checked at the ticket and again
// on the stored copy (docs/technical/document-storage-and-access.md, "Upload flow").

/** The types and the size limit one kind of upload accepts. */
export type UploadRule = { mimeTypes: readonly string[]; maxSizeBytes: number };

/** Why a file breaks its rule, or null when it fits. */
export function uploadRuleFailure(
  rule: UploadRule,
  mimeType: string | null,
  sizeBytes: number | null,
): 'file_type_not_allowed' | 'file_empty' | 'file_too_large' | null {
  if (mimeType === null || !rule.mimeTypes.includes(mimeType)) return 'file_type_not_allowed';
  if (sizeBytes === null || sizeBytes <= 0) return 'file_empty';
  return sizeBytes > rule.maxSizeBytes ? 'file_too_large' : null;
}
