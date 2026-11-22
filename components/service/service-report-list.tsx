'use client';

import { useRef, type ReactElement } from 'react';
import { ClipboardCheck, MapPin } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';
import { DUE_ROW_CLASS } from '@/components/service/maintenance-lists';
import { ListPagination } from '@/components/shared/list-pagination';
import { StaleRegion } from '@/components/shared/stale-region';
import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useLiveView } from '@/hooks/use-live-view';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import { getDocumentSignedUrl } from '@/lib/documents/actions';
import { MAINTENANCE_SCOPE_OUTCOME_LABELS } from '@/lib/maintenance/types';
import { createServiceReport } from '@/lib/service-reports/actions';
import {
  SERVICE_REPORT_PAGE_PARAM,
  type CompletedVisit,
  type CompletedVisitPage,
} from '@/lib/service-reports/types';
import { formatGermanDate } from '@/lib/utils';

// „Abgeschlossene Wartungsbesuche“ on the Wartung page: each completed visit
// with „Servicebericht erstellen“, and once filed „Herunterladen“ and „Neu
// erstellen“. A report reaches the visit job's documents, where the assigned
// employee downloads it too.

// A finished visit is a reached good state; an unfinished one is neutral, its next step lives in Aufgaben.
const OUTCOME_VARIANTS = { complete: 'success', partial: 'secondary', unresolved: 'secondary' } as const;

const REPORT_FAILURES: Readonly<Record<string, string>> = {
  service_report_stale:
    'Inzwischen wurde ein neuerer Servicebericht erstellt. Die Liste zeigt ihn jetzt; versuche es dort erneut.',
  service_report_visit_not_completed: 'Der Besuch ist nicht abgeschlossen. Lade die Seite neu.',
  maintenance_due_not_found: 'Den Besuch gibt es nicht mehr. Lade die Seite neu.',
  service_report_recipient_missing:
    'Der Auftrag hat keinen Kunden als Empfänger. Trage im Auftrag einen Auftraggeber ein.',
};

function VisitRow({ visit, actions }: { visit: CompletedVisit; actions: ReportActions }): ReactElement {
  const report = visit.latestReport;
  const busy = actions.isBusy(visit.dueWorkId);
  return (
    <ListRow variant="plain" data-testid="service-report-row" className={DUE_ROW_CLASS}>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 @3xl/maintenance:block">
        <span className="block font-medium">{formatGermanDate(visit.completedOn)}</span>
        <Badge variant={OUTCOME_VARIANTS[visit.outcome]}>
          {MAINTENANCE_SCOPE_OUTCOME_LABELS[visit.outcome]}
        </Badge>
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{visit.planNumber}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {visit.equipmentNames.join(', ')}
        </span>
      </span>
      <span className="min-w-0 text-sm">
        <span className="block truncate">{visit.clientName}</span>
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {visit.siteName}
          {visit.jobNumber ? ` · Auftrag ${visit.jobNumber}` : ''}
        </span>
      </span>
      <fieldset
        disabled={busy}
        className="flex min-w-0 flex-wrap items-center gap-2 @3xl/maintenance:justify-end"
      >
        <InlinePending active={busy} label="Servicebericht wird bearbeitet" />
        {report ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => actions.download(visit, report.documentId)}
            >
              Herunterladen
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => actions.create(visit)}>
              Neu erstellen
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" onClick={() => actions.create(visit)}>
            Servicebericht erstellen
          </Button>
        )}
      </fieldset>
    </ListRow>
  );
}

/** Create and download, each pending on its row and answered by a banner. */
function useReportActions(refresh: () => Promise<void>) {
  const busy = useBusyIds();
  const { showBanner } = useBanner();
  // An attempt whose answer was lost keeps its id, so the retry answers with the report it made.
  const attempts = useRef(new Map<string, string>());
  const create = (visit: CompletedVisit) =>
    void busy.run(visit.dueWorkId, async () => {
      // A kept attempt the list now shows as the latest report committed: a new click regenerates.
      const kept = attempts.current.get(visit.dueWorkId);
      const reportId = kept && kept !== visit.latestReport?.id ? kept : crypto.randomUUID();
      attempts.current.set(visit.dueWorkId, reportId);
      // A lost answer (the request failed in transit) is uncertain, like `unexpected_error`.
      const result = await createServiceReport({
        dueWorkId: visit.dueWorkId,
        reportId,
        replacesReportId: visit.latestReport?.id ?? null,
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (result.success || result.error !== 'unexpected_error') attempts.current.delete(visit.dueWorkId);
      await refresh();
      showBanner(
        result.success
          ? { variant: 'success', message: 'Servicebericht erstellt und beim Auftrag abgelegt.' }
          : {
              variant: 'error',
              message: describeFailure(
                result.error,
                REPORT_FAILURES,
                'Der Servicebericht konnte nicht erstellt werden. Versuche es erneut.',
              ),
            },
      );
    });
  const download = (visit: CompletedVisit, documentId: string) =>
    void busy.run(visit.dueWorkId, async () => {
      const result = await getDocumentSignedUrl(documentId).catch(() => ({ success: false as const }));
      if (result.success) window.location.assign(result.signedUrl);
      else showBanner({ variant: 'error', message: 'Der Servicebericht konnte nicht geladen werden.' });
    });
  return { create, download, isBusy: busy.isBusy };
}

type ReportActions = ReturnType<typeof useReportActions>;

export function ServiceReportList({ initial }: { initial: CompletedVisitPage }): ReactElement {
  const navigation = useListNavigation();
  return (
    <ServiceReportPage
      key={initial.page}
      initial={initial}
      paging={navigation.busy}
      onPageChange={(page) => navigation.navigate({ [SERVICE_REPORT_PAGE_PARAM]: page })}
    />
  );
}

function ServiceReportPage({
  initial,
  paging,
  onPageChange,
}: {
  initial: CompletedVisitPage;
  paging: boolean;
  onPageChange: (page: number) => void;
}): ReactElement {
  const { activeOrgId } = useOrganization();
  // Reads over GET, outside the Server Action queue the report action uses.
  const live = useLiveView({
    tables: ['maintenance_due_work', 'documents'],
    initialData: initial,
    coalesceWhileReading: true,
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: false as const };
      const result = await readInBackground(
        'completed-maintenance-visits',
        { organizationId: activeOrgId, page: initial.page },
        signal,
      );
      return result.success
        ? { ok: true as const, data: result.page }
        : { ok: false as const, error: result.error };
    },
  });
  const view = live.data ?? initial;
  const actions = useReportActions(live.refresh);

  return (
    <StaleRegion stale={live.isStale} onRetry={live.refresh}>
      {view.total === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Noch keine abgeschlossenen Wartungsbesuche"
          description="Schließe eine Fälligkeit mit ihrem Nachweis ab. Danach erstellst du hier den Servicebericht."
        />
      ) : (
        <div className="@container/maintenance space-y-3">
          <div className="divide-y overflow-hidden rounded-lg border shadow-xs">
            {view.items.map((visit) => (
              <VisitRow key={visit.dueWorkId} visit={visit} actions={actions} />
            ))}
          </div>
          <ListPagination
            page={view.page}
            total={view.total}
            pageSize={view.pageSize}
            onPageChange={onPageChange}
            busy={paging}
            label="Abgeschlossene Wartungsbesuche"
          />
        </div>
      )}
    </StaleRegion>
  );
}
