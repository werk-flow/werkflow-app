'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { ContextualDocumentsSkeleton } from '@/components/dokumente/contextual-documents-layout';
import { SectionError } from '@/components/ui/section-error';
import { readInBackground } from '@/lib/data/background-read-client';
import type { OrganizationDocument } from '@/lib/documents/types';

// The documents part of „Verlauf und Dokumente“. The work pack loads the
// document section already, so the opener renders this part and hands it to the
// lazily loaded dialog: in the dialog's own chunk the section regrouped the
// chunks every route shares (`lab.field.cold-start`).

type DocumentsState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; documents: OrganizationDocument[] };

const DOCUMENTS_DESCRIPTION =
  'Bedienungsanleitungen und Unterlagen, die das Büro mit dieser Anlage verknüpft hat.';

/** The ordinary documents of one Anlage of the job, read online when the dialog opens. */
export function FieldEquipmentDocuments({
  jobId,
  equipment,
}: {
  jobId: string;
  equipment: { id: string; equipmentNumber: string };
}): ReactElement {
  const [state, setState] = useState<DocumentsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readInBackground(
      'equipment-field-documents',
      { jobId, equipmentId: equipment.id },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.success ? { status: 'ready', documents: result.documents } : { status: 'failed' });
    });
    return () => controller.abort();
  }, [jobId, equipment.id, attempt]);

  if (state.status === 'loading') {
    return <ContextualDocumentsSkeleton title="Dokumente" description={DOCUMENTS_DESCRIPTION} />;
  }
  if (state.status === 'failed') {
    return (
      <SectionError
        onRetry={() => {
          setState({ status: 'loading' });
          setAttempt((count) => count + 1);
        }}
      >
        Die Dokumente dieser Anlage konnten nicht geladen werden.
      </SectionError>
    );
  }
  return (
    <ContextualDocumentsSection
      title="Dokumente"
      description={DOCUMENTS_DESCRIPTION}
      documents={state.documents}
      documentTarget={{ kind: 'equipment', equipmentId: equipment.id }}
      contextLabel={equipment.equipmentNumber}
      canUpload={false}
      canManage={false}
    />
  );
}
