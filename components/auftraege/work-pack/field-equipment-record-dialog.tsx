'use client';

import { useEffect, useState, type ReactElement } from 'react';

import {
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATE_LABELS,
} from '@/components/auftraege/artifacts/work-artifact-content';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { ContextualDocumentsSkeleton } from '@/components/dokumente/contextual-documents-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { readInBackground } from '@/lib/data/background-read-client';
import type { OrganizationDocument } from '@/lib/documents/types';
import type {
  FieldHistoryEntry,
  FieldHistoryEquipment,
  FieldHistoryVisit,
} from '@/lib/installed-equipment/field-history-reads';
import { MAINTENANCE_SCOPE_OUTCOME_LABELS } from '@/lib/maintenance/types';
import { formatBerlin } from '@/lib/utils';
import { WORK_ARTIFACT_UNIT_LABELS } from '@/lib/work-artifacts/types';

// Loaded on the worker's intent through components/shared/lazy-dialog.tsx, so
// the field work pack's cold start never carries it (`lab.field.cold-start`).
// Online only: the offline pack keeps what E7 stores (werk-flow/werkflow-planning#468).

export type FieldEquipmentRecordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  equipment: { id: string; equipmentNumber: string; name: string };
};

type DocumentsState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; documents: OrganizationDocument[] };
type HistoryState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; entries: FieldHistoryEntry[]; nextCursor: string | null };

/** „Verlauf und Dokumente“ of one Anlage on the technician's job. */
export function FieldEquipmentRecordDialog({
  open,
  onOpenChange,
  jobId,
  equipment,
}: FieldEquipmentRecordDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Verlauf und Dokumente</DialogTitle>
          <DialogDescription>
            {equipment.name} · {equipment.equipmentNumber}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-6">
          <EquipmentDocuments open={open} jobId={jobId} equipment={equipment} />
          <EquipmentHistory open={open} jobId={jobId} equipmentId={equipment.id} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

const DOCUMENTS_DESCRIPTION =
  'Bedienungsanleitungen und Unterlagen, die das Büro mit dieser Anlage verknüpft hat.';

function EquipmentDocuments({
  open,
  jobId,
  equipment,
}: Pick<FieldEquipmentRecordDialogProps, 'open' | 'jobId' | 'equipment'>): ReactElement {
  const [state, setState] = useState<DocumentsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
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
  }, [jobId, equipment.id, open, attempt]);

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

/** The history's first page on open, its retry, and the older pages „Mehr laden“ appends. */
function useFieldHistory(open: boolean, jobId: string, equipmentId: string) {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void readInBackground(
      'equipment-field-history',
      { jobId, equipmentId, before: null },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.success ? { status: 'ready', ...result.page } : { status: 'failed' });
    });
    return () => controller.abort();
  }, [jobId, equipmentId, open, attempt]);

  const loadMore = (before: string) => {
    setIsLoadingMore(true);
    setMoreFailed(false);
    void readInBackground('equipment-field-history', { jobId, equipmentId, before }).then((result) => {
      setIsLoadingMore(false);
      if (!result.success) {
        setMoreFailed(true);
        return;
      }
      setState((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              entries: [...current.entries, ...result.page.entries],
              nextCursor: result.page.nextCursor,
            }
          : current,
      );
    });
  };
  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  };
  return { state, retry, loadMore, isLoadingMore, moreFailed };
}

function EquipmentHistory({
  open,
  jobId,
  equipmentId,
}: Pick<FieldEquipmentRecordDialogProps, 'open' | 'jobId'> & { equipmentId: string }): ReactElement {
  const { state, retry, loadMore, isLoadingMore, moreFailed } = useFieldHistory(open, jobId, equipmentId);

  return (
    <section aria-labelledby="field-equipment-history" className="space-y-3">
      <h3 id="field-equipment-history" className="text-sm font-semibold">
        Verlauf
      </h3>
      {state.status === 'loading' ? (
        <HistorySkeleton />
      ) : state.status === 'failed' ? (
        <SectionError onRetry={retry}>Der Verlauf dieser Anlage konnte nicht geladen werden.</SectionError>
      ) : state.entries.length === 0 ? (
        <EmptyState
          size="compact"
          title="Noch kein Verlauf."
          description="Erledigte Wartungsbesuche und ein Austausch dieser Anlage erscheinen hier."
        />
      ) : (
        <>
          <ol className="space-y-2">
            {state.entries.map((entry) => (
              <li key={entry.key} className="rounded-md border p-3">
                {entry.kind === 'visit' ? <VisitEntry visit={entry} /> : <ReplacementEntry entry={entry} />}
              </li>
            ))}
          </ol>
          {state.nextCursor && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                pending={isLoadingMore}
                onClick={() => state.nextCursor && loadMore(state.nextCursor)}
              >
                Mehr laden
              </Button>
              {moreFailed && (
                <ErrorText>Weitere Einträge konnten nicht geladen werden. Versuche es erneut.</ErrorText>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function equipmentLabel(equipment: FieldHistoryEquipment): string {
  return `${equipment.isPredecessor ? 'Vorgänger ' : ''}${equipment.equipmentNumber} · ${equipment.name}`;
}

function VisitEntry({ visit }: { visit: FieldHistoryVisit }): ReactElement {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Wartungsbesuch am {formatBerlin(visit.date, 'numericDate')}</p>
        <Badge variant={visit.outcome === 'complete' ? 'success' : 'warning'}>
          {MAINTENANCE_SCOPE_OUTCOME_LABELS[visit.outcome]}
        </Badge>
      </div>
      {visit.equipment.isPredecessor && (
        <p className="text-xs text-muted-foreground">{equipmentLabel(visit.equipment)}</p>
      )}
      {visit.defects.length > 0 && (
        <ul className="space-y-1">
          {visit.defects.map((defect, index) => (
            <li key={index}>
              <span className="font-medium">Mangel:</span> {defect.description}
              <span className="text-muted-foreground">
                {' '}
                · {defect.location} · {DEFECT_SEVERITY_LABELS[defect.severity]} ·{' '}
                {DEFECT_STATE_LABELS[defect.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {visit.measurements.length > 0 && (
        <ul className="space-y-1">
          {visit.measurements.map((line, index) => (
            <li key={index}>
              <span className="font-medium">Messung:</span> {line.description}{' '}
              {line.quantity.toLocaleString('de-DE')} {WORK_ARTIFACT_UNIT_LABELS[line.unit]}
              {line.location && <span className="text-muted-foreground"> · {line.location}</span>}
            </li>
          ))}
        </ul>
      )}
      {visit.defects.length === 0 && visit.measurements.length === 0 && (
        <EmptyState size="compact" title="Keine Mängel oder Messungen im Nachweis." />
      )}
    </div>
  );
}

function ReplacementEntry({
  entry,
}: {
  entry: Extract<FieldHistoryEntry, { kind: 'replacement' }>;
}): ReactElement {
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">Austausch am {formatBerlin(entry.date, 'numericDate')}</p>
      <p className="text-muted-foreground">
        {equipmentLabel(entry.predecessor)}
        {entry.successor ? ` ersetzt durch ${entry.successor.equipmentNumber} · ${entry.successor.name}` : ''}
      </p>
    </div>
  );
}

function HistorySkeleton(): ReactElement {
  return (
    <div className="space-y-2" role="status" aria-busy="true">
      <span className="sr-only">Verlauf wird geladen.</span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-2 rounded-md border p-3">
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      ))}
    </div>
  );
}
