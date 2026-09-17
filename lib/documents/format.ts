const oneDecimal = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Human-readable file size for document lists and dialogs, with the German decimal comma. */
export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${oneDecimal.format(sizeBytes / 1024)} KB`;
  return `${oneDecimal.format(sizeBytes / 1024 / 1024)} MB`;
}
