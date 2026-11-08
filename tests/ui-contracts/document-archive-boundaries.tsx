import { useState } from 'react';
import { DocumentDetailsArchive } from '@/components/dokumente/document-details-archive';
import type { DocumentOrigin, DocumentRetentionTerms, OrganizationDocument } from '@/lib/documents/types';

declare global {
  interface Window {
    documentArchiveContract: {
      writes: DocumentRetentionTerms[];
      originWrites: DocumentOrigin[];
      filings: string[];
      refuseNext: boolean;
    };
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
  origin: { sourceSystem: null, sourceReference: null },
  archive: {
    documentDate: '2026-03-14',
    retentionClass: 'ten_years',
    retentionEndsOn: '2036-12-31',
    filedAt: null,
    filer: null,
  },
};

/**
 * „Herkunft“ and „Aufbewahrung“ of an unfiled invoice. Each origin and
 * retention write is recorded and applied at once, as the details apply it;
 * `refuseNext` makes the next write fail and puts the stored values back.
 * Each filing request is recorded.
 */
export function DocumentArchiveContractFixture(): React.JSX.Element {
  const [document, setDocument] = useState(invoice);
  return (
    <main>
      <DocumentDetailsArchive
        document={document}
        disabled={false}
        isTrashView={false}
        onUpdateRetention={async (current, terms) => {
          const contract = window.documentArchiveContract;
          contract.writes.push(terms);
          if (current.archive) setDocument({ ...current, archive: { ...current.archive, ...terms } });
          await Promise.resolve();
          if (!contract.refuseNext) return true;
          contract.refuseNext = false;
          setDocument(current);
          return false;
        }}
        onUpdateOrigin={async (current, origin) => {
          const contract = window.documentArchiveContract;
          contract.originWrites.push(origin);
          setDocument({ ...current, origin });
          await Promise.resolve();
          if (!contract.refuseNext) return true;
          contract.refuseNext = false;
          setDocument(current);
          return false;
        }}
        onFile={(current) => window.documentArchiveContract.filings.push(current.id)}
      />
    </main>
  );
}

export function initializeDocumentArchiveBoundary(): void {
  window.documentArchiveContract = { writes: [], originWrites: [], filings: [], refuseNext: false };
}
