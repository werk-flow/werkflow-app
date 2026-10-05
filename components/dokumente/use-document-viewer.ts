'use client';

import { useEffect, useRef, useState } from 'react';

import type { OrganizationDocument } from '@/lib/documents/types';

/**
 * The document shown in the viewer dialog. It starts with the document the
 * route links to and follows that route payload while it is the one on screen.
 */
export function useDocumentViewer({
  initialDocument,
  initialDocumentId,
}: {
  initialDocument: OrganizationDocument | null;
  initialDocumentId: string | null;
}): {
  viewerDocument: OrganizationDocument | null;
  openDocumentViewer: (document: OrganizationDocument) => void;
  closeDocumentViewer: () => void;
} {
  const [viewerDocument, setViewerDocument] = useState<OrganizationDocument | null>(initialDocument);
  const initialDocumentIdRef = useRef(initialDocumentId);

  useEffect(() => {
    const viewingInitialDocument = viewerDocument?.id === initialDocumentIdRef.current;
    const initialDocumentChanged = initialDocumentIdRef.current !== initialDocumentId;
    initialDocumentIdRef.current = initialDocumentId;
    if (initialDocumentChanged || viewingInitialDocument) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep an open viewer synchronized with the authoritative route payload
      setViewerDocument(initialDocument);
    }
  }, [initialDocument, initialDocumentId, viewerDocument?.id]);

  function openDocumentViewer(document: OrganizationDocument) {
    setViewerDocument(document);
  }

  function closeDocumentViewer() {
    setViewerDocument(null);
  }

  return { viewerDocument, openDocumentViewer, closeDocumentViewer };
}
