'use client';

import { Download, FileLock2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';

import type { PersonnelLifecycleDocuments } from './use-personnel-lifecycle-documents';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';

type PersonnelLifecycleDocumentsListProps = {
  lifecycle: PersonnelLifecycleController;
  documents: PersonnelLifecycleDocuments;
  canManage: boolean;
};

export function PersonnelLifecycleDocumentsList({
  lifecycle,
  documents,
  canManage,
}: PersonnelLifecycleDocumentsListProps) {
  const { data, mutationDisabled, rowBusy, setError, setFieldErrors } = lifecycle;
  const { setUploadOpen, downloadDocument, toggleRelease } = documents;

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <FileLock2 className="size-4" /> Geschützte Personalunterlagen
          </h3>
          <p className="text-xs text-muted-foreground">
            Getrennt von „Dokumente & Bilder“ und an den Personalstammsatz gebunden.
          </p>
        </div>
        {canManage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={mutationDisabled}
            onClick={() => {
              setError(null);
              setFieldErrors({});
              setUploadOpen(true);
            }}
          >
            <Plus className="size-4" /> Datei
          </Button>
        ) : null}
      </div>
      {data.documents.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Keine geschützten Personalunterlagen vorhanden.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{document.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {document.documentType} ·{' '}
                  {document.releasedToEmployee ? 'für Person freigegeben' : 'nicht freigegeben'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <InlinePending active={rowBusy.isBusy(document.id)} label="Dokument wird aktualisiert" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void downloadDocument(document)}
                  disabled={rowBusy.isBusy(document.id)}
                >
                  <Download className="size-4" /> Öffnen
                </Button>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void toggleRelease(document)}
                    disabled={mutationDisabled || rowBusy.isBusy(document.id) || !data.userId}
                  >
                    {document.releasedToEmployee ? 'Freigabe entziehen' : 'Freigeben'}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
