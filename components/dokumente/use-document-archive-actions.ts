'use client';

import { describeFailure } from '@/lib/action-messages';
import { fileDocument, updateDocumentRetention } from '@/lib/documents/actions';
import type { DocumentResult, DocumentRetentionTerms, OrganizationDocument } from '@/lib/documents/types';
import type { DocumentConfirmDialogState } from './use-document-delete-actions';
import type { DocumentDetailsDialogState } from './use-document-details-dialog';
import type { DocumentLibraryMutations } from './use-document-library-mutations';

const ARCHIVE_FAILURE_MESSAGES = {
  document_filed: 'Die Datei ist festgeschrieben und lässt sich nicht mehr ändern.',
  protected_document_boundary: 'Personalunterlagen haben eigene Aufbewahrungsregeln.',
  document_date_out_of_range: 'Das Belegdatum muss zwischen 1900 und einem Jahr nach heute liegen.',
} satisfies Record<string, string>;

/**
 * Runs a retention or filing write under the document's busy id. The result
 * shows in the details dialog while it still shows that document; a refusal
 * puts the document back and names the reason there. Resolves whether the
 * write was saved.
 */
function runArchiveWrite({
  details,
  busy,
  document,
  write,
  fallback,
}: {
  details: DocumentDetailsDialogState;
  busy: DocumentLibraryMutations['busy'];
  document: OrganizationDocument;
  write: () => Promise<DocumentResult>;
  fallback: string;
}): Promise<boolean> {
  const { detailsDialogIdRef, setDetailsDialog, setDetailsError } = details;
  const fail = (error: string) => {
    if (detailsDialogIdRef.current !== document.id) return;
    setDetailsDialog(document);
    setDetailsError(describeFailure(error, ARCHIVE_FAILURE_MESSAGES, fallback));
  };
  setDetailsError(null);
  return busy
    .run(document.id, async () => {
      const result = await write();
      if (!result.success) {
        fail(result.error);
        return false;
      }
      if (detailsDialogIdRef.current === document.id) setDetailsDialog(result.document);
      return true;
    })
    .catch(() => {
      fail('request_failed');
      return false;
    });
}

/**
 * The document date, the retention class and filing (`Festschreiben`) in the
 * „Dateidetails" dialog. Date and class change at once and roll back on a
 * refusal; filing passes the library's confirmation first.
 */
export function useDocumentArchiveActions({
  details,
  mutations,
  isTrashView,
  confirm,
}: {
  details: DocumentDetailsDialogState;
  mutations: DocumentLibraryMutations;
  isTrashView: boolean;
  confirm: (dialog: DocumentConfirmDialogState) => void;
}) {
  const { busy } = mutations;

  function handleUpdateRetention(
    document: OrganizationDocument,
    terms: DocumentRetentionTerms,
  ): Promise<boolean> {
    if (isTrashView || !document.archive) return Promise.resolve(false);
    details.setDetailsDialog({ ...document, archive: { ...document.archive, ...terms } });
    return runArchiveWrite({
      details,
      busy,
      document,
      write: () => updateDocumentRetention({ documentId: document.id, ...terms }),
      fallback: 'Die Aufbewahrung konnte nicht geändert werden.',
    });
  }

  function handleFileDocument(document: OrganizationDocument) {
    if (isTrashView) return;
    confirm({
      title: 'Datei festschreiben?',
      description: `„${document.displayName}“ wird endgültig festgeschrieben. Danach lassen sich Inhalt, Belegdatum und Aufbewahrungsfrist nicht mehr ändern, und die Datei lässt sich nicht mehr löschen. Name, Ordner, Kategorie und Verknüpfungen bleiben änderbar.`,
      confirmLabel: 'Festschreiben',
      onConfirm: () =>
        void runArchiveWrite({
          details,
          busy,
          document,
          write: () => fileDocument(document.id),
          fallback: 'Die Datei konnte nicht festgeschrieben werden.',
        }),
    });
  }

  return { handleUpdateRetention, handleFileDocument };
}
