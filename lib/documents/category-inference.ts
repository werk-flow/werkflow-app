import type { DocumentCategory } from './types';

/** Guesses a category from the file name and type when the uploader chose none. */
export function inferDocumentCategory({
  fileName,
  mimeType,
}: {
  fileName: string;
  mimeType: string;
}): DocumentCategory {
  const lowerName = fileName.toLowerCase();
  const lowerMimeType = mimeType.toLowerCase();

  if (lowerMimeType.startsWith('image/')) return 'photo';
  if (lowerName.includes('rechnung') || lowerName.includes('invoice') || lowerName.includes('quittung')) {
    return 'invoice';
  }
  if (lowerName.includes('vertrag') || lowerName.includes('contract') || lowerName.includes('vereinbarung')) {
    return 'contract';
  }
  if (
    lowerName.includes('angebot') ||
    lowerName.includes('offer') ||
    lowerName.includes('kostenvoranschlag')
  ) {
    return 'offer';
  }
  if (lowerName.includes('bericht') || lowerName.includes('protokoll') || lowerName.includes('report')) {
    return 'report';
  }

  return 'other';
}
