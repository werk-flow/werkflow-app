import type { ReactElement } from 'react';

import type { ContextualDocumentLinkContext } from './contextual-documents-context';

type ContextualDocumentsEmptyStateProps = {
  canUpload: boolean;
  /** Whether this list offers linking an existing library document. */
  canAttach: boolean;
  context: ContextualDocumentLinkContext;
  contextLabel?: string | undefined;
};

/** Placeholder of a contextual document list without documents. */
export function ContextualDocumentsEmptyState({
  canUpload,
  canAttach,
  context,
  contextLabel,
}: ContextualDocumentsEmptyStateProps): ReactElement {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
      <p className="text-sm font-medium">Noch keine Dokumente vorhanden.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {canUpload
          ? canAttach
            ? 'Lade Dateien hoch oder verknüpfe vorhandene Dokumente aus der Dokumentenablage.'
            : context.jobId
              ? 'Lade Dateien direkt zu diesem Auftrag hoch.'
              : context.projectId
                ? 'Lade Dateien direkt zu diesem Projekt hoch.'
                : context.requestId
                  ? 'Lade Dateien direkt zu dieser Anfrage hoch.'
                  : contextLabel
                    ? `Lade Dateien direkt zu ${contextLabel} hoch.`
                    : 'Lade Dateien direkt in diesem Bereich hoch.'
          : 'Sobald Dokumente vorhanden sind, erscheinen sie hier.'}
      </p>
    </div>
  );
}
