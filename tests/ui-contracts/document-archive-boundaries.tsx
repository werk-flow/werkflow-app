import { useState } from 'react';
import { DocumentDetailsArchive } from '@/components/dokumente/document-details-archive';
import type { DocumentRetentionTerms, OrganizationDocument } from '@/lib/documents/types';

declare global {
  interface Window {
    documentArchiveContract: { writes: DocumentRetentionTerms[] };
  }
}

const invoice: OrganizationDocument = {
  id: 'contract-document',
  organizationId: 'contract-organization',
  folderId: null,
  category: 'invoice',
  storageBucket: 'documents',
  storagePath: 'contract-organization/contract-document/rechnung.pdf',
  originalFileName: 'rechnung.pdf',
  displayName: 'Rechnung 17.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  uploadedBy: 'contract-office',
  copiedFromDocumentId: null,
  currentVersionNumber: 1,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  metadata: {},
  createdAt: '2026-03-14T09:00:00.000Z',
  updatedAt: '2026-03-14T09:00:00.000Z',
  uploader: null,
  links: [],
  archive: {
    documentDate: '2026-03-14',
    retentionClass: 'ten_years',
    retentionEndsOn: '2036-12-31',
    filedAt: null,
    filer: null,
  },
};

/** „Aufbewahrung“ of an unfiled invoice; each retention write is recorded and applied as the details apply it. */
export function DocumentArchiveContractFixture(): React.JSX.Element {
  const [document, setDocument] = useState(invoice);
  return (
    <main>
      <DocumentDetailsArchive
        document={document}
        disabled={false}
        isTrashView={false}
        onUpdateRetention={(current, terms) => {
          window.documentArchiveContract.writes.push(terms);
          if (current.archive) setDocument({ ...current, archive: { ...current.archive, ...terms } });
        }}
        onFile={() => undefined}
      />
    </main>
  );
}

export function initializeDocumentArchiveBoundary(): void {
  window.documentArchiveContract = { writes: [] };
}
