'use client';

import { describeFailure } from '@/lib/action-messages';
import { fileDocument, updateDocumentOrigin, updateDocumentRetention } from '@/lib/documents/actions';
import type {
  DocumentOrigin,
  DocumentResult,
  DocumentRetentionTerms,
  OrganizationDocument,
} from '@/lib/documents/types';
import type { DocumentConfirmDialogState } from './use-document-delete-actions';
import type { DocumentDetailsDialogState } from './use-document-details-dialog';
import type { DocumentLibraryMutations } from './use-document-library-mutations';

const ARCHIVE_FAILURE_MESSAGES = {
  document_filed: 'Die Datei ist festgeschrieben und lässt sich nicht mehr ändern.',
  protected_document_boundary: 'Personalunterlagen haben eigene Aufbewahrungsregeln.',
  document_date_out_of_range: 'Das Belegdatum muss zwischen 1900 und einem Jahr nach heute liegen.',
} satisfies Record<string, string>;

/**
 * Runs an origin, retention or filing write under the document's busy id. The result
 * shows in the details dialog while it still shows that document; a refusal
 * puts the document back and names the reason there. A saved write stays busy
 * until the revalidated library lands, or reports the unconfirmed refresh.
 * Resolves whether the write was saved.
 */
function runArchiveWrite({
  details,
  mutations: { busy, waitForDocuments },
  document,
  write,
  fallback,
}: {
  details: DocumentDetailsDialogState;
  mutations: DocumentLibraryMutations;
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
  // The action's response carries the revalidated library and can land before the write resolves.
  const since = waitForDocuments.markChange();
  return busy
    .run(document.id, async () => {
      const result = await write();
      if (!result.success) {
        fail(result.error);
        return false;
      }
      if (detailsDialogIdRef.current === document.id) setDetailsDialog(result.document);
      await waitForDocuments(since);
      return true;
    })
    .catch(() => {
      fail('request_failed');
      return false;
    });
}

/**
 * The origin, the document date, the retention class and filing
 * (`Festschreiben`) in the „Dateidetails" dialog. Origin, date and class change
 * at once and roll back on a refusal; filing passes the library's confirmation
 * first.
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
  function handleUpdateRetention(
    document: OrganizationDocument,
    terms: DocumentRetentionTerms,
  ): Promise<boolean> {
    if (isTrashView || !document.archive) return Promise.resolve(false);
    details.setDetailsDialog({ ...document, archive: { ...document.archive, ...terms } });
    return runArchiveWrite({
      details,
      mutations,
      document,
      write: () => updateDocumentRetention({ documentId: document.id, ...terms }),
      fallback: 'Die Aufbewahrung konnte nicht geändert werden.',
    });
  }

  function handleUpdateOrigin(document: OrganizationDocument, origin: DocumentOrigin): Promise<boolean> {
    if (isTrashView || !document.archive) return Promise.resolve(false);
    details.setDetailsDialog({ ...document, origin });
    return runArchiveWrite({
      details,
      mutations,
      document,
      write: () =>
        updateDocumentOrigin({
          documentId: document.id,
          sourceSystem: origin.sourceSystem ?? '',
          sourceReference: origin.sourceReference ?? '',
        }),
      fallback: 'Die Herkunft konnte nicht gespeichert werden.',
    });
  }

  function handleFileDocument(document: OrganizationDocument) {
    if (isTrashView) return;
    confirm({
      title: 'Datei festschreiben?',
      description: `„${document.displayName}“ wird endgültig festgeschrieben. Danach lassen sich Inhalt, Herkunft, Belegdatum und Aufbewahrungsfrist nicht mehr ändern, und die Datei lässt sich nicht mehr löschen. Name, Ordner, Kategorie und Verknüpfungen bleiben änderbar.`,
      confirmLabel: 'Festschreiben',
      // The details dialog under the confirmation shows the step's spinner and a refusal.
      onConfirm: () => {
        void runArchiveWrite({
          details,
          mutations,
          document,
          write: () => fileDocument(document.id),
          fallback: 'Die Datei konnte nicht festgeschrieben werden.',
        });
        return Promise.resolve(null);
      },
    });
  }

  return { handleUpdateRetention, handleUpdateOrigin, handleFileDocument };
}
