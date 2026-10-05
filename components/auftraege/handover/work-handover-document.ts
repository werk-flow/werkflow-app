'use client';

import { getDocumentSignedUrl } from '@/lib/documents/actions';

export async function openDocument(documentId: string): Promise<string | null> {
  const documentWindow = window.open('about:blank', '_blank');
  if (!documentWindow) {
    return 'Der Browser hat das Fenster blockiert. Erlaube Pop-ups und versuche es erneut.';
  }
  documentWindow.opener = null;
  const result = await getDocumentSignedUrl(documentId);
  if (!result.success) {
    documentWindow.close();
    return 'Das Übergabedokument konnte nicht geöffnet werden.';
  }
  documentWindow.location.replace(result.signedUrl);
  return null;
}
