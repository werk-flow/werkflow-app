'use client';

import { useState } from 'react';
import { Thermometer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { cancelSicknessReport, type OwnSicknessOverview } from '@/lib/sickness/actions';
import { readInBackground } from '@/lib/data/background-read-client';
import { formatSicknessRange, SICKNESS_ERROR_MESSAGES, type SicknessReport } from '@/lib/sickness/types';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { OwnSicknessEndDialog } from './sickness-section-end-dialog';
import { OwnSicknessReportDialog } from './sickness-section-report-dialog';
import { OwnSicknessReportList } from './sickness-section-report-list';

// Settle key for a report that has no row yet; report ids are UUIDs.
const NEW_REPORT_ID = 'new';

export function SicknessSection() {
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [endReport, setEndReport] = useState<SicknessReport | null>(null);
  const [cancelReport, setCancelReport] = useState<SicknessReport | null>(null);

  const view = useLiveView<OwnSicknessOverview>({
    tables: ['sickness_reports'],
    read: async ({ signal }): Promise<LiveViewResult<OwnSicknessOverview>> => {
      const result = await readInBackground('own-sickness-reports', {}, signal);
      return result.success ? { ok: true, data: result.overview } : { ok: false };
    },
  });

  const overview = view.data ?? null;
  const isLoading = view.isLoading;
  // Keep last-known data on transient failure; only an initial load that
  // never produced data shows the error state.
  const loadFailed = !isLoading && overview === null;
  // A dialog closes as soon as the server saved; the affected row (or the
  // section header for a new report) shows the settle spinner until the
  // authoritative read lands.
  const settling = useBusyIds();
  const settle = (id: string) => void settling.run(id, view.refresh);

  const activeReports = (overview?.reports ?? []).filter((report) => report.status === 'reported');
  const pastReports = (overview?.reports ?? []).filter((report) => report.status !== 'reported');

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-1">
        Krankmeldung
        <InlinePending active={settling.isBusy(NEW_REPORT_ID)} />
      </h3>

      {/* A failed first read is a failure with retry, never an empty card. */}
      {loadFailed ? (
        <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
          Die Krankmeldungen konnten nicht geladen werden.
        </SectionError>
      ) : (
        <Card>
          <CardContent className="p-4">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : (
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Thermometer className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Krank oder verhindert?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Melde deine Abwesenheit mit wenigen Angaben. Ein Enddatum kannst du später nachtragen.
                  </p>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setShowReportDialog(true)}
                      disabled={!overview?.employeeRecordId}
                    >
                      <Thermometer className="size-3.5" />
                      Krank melden
                    </Button>
                    {overview && !overview.employeeRecordId && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {SICKNESS_ERROR_MESSAGES.no_employee_record}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {overview && (activeReports.length > 0 || pastReports.length > 0) && (
        <OwnSicknessReportList
          activeReports={activeReports}
          pastReports={pastReports}
          settling={settling}
          setEndReport={setEndReport}
          setCancelReport={setCancelReport}
        />
      )}

      {showReportDialog && (
        <OwnSicknessReportDialog
          onClose={(saved) => {
            setShowReportDialog(false);
            if (saved) settle(NEW_REPORT_ID);
          }}
        />
      )}

      {endReport && (
        <OwnSicknessEndDialog
          report={endReport}
          onClose={(saved) => {
            setEndReport(null);
            if (saved) settle(endReport.id);
          }}
        />
      )}

      {cancelReport && (
        <SicknessCancelDialog
          report={cancelReport}
          onClose={(saved) => {
            setCancelReport(null);
            if (saved) settle(cancelReport.id);
          }}
        />
      )}
    </div>
  );
}

function SicknessCancelDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const { run: runCancel, isPending: isSaving } = useServerAction(cancelSicknessReport);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (isSaving) return;
    setError(null);
    try {
      const result = await runCancel({ reportId: report.id });
      if (result.success) {
        onClose(true);
      } else {
        setError(
          describeFailure(
            result.error,
            SICKNESS_ERROR_MESSAGES,
            'Die Meldung konnte nicht storniert werden.',
          ),
        );
      }
    } catch {
      setError('Die Meldung konnte nicht storniert werden.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Krankmeldung stornieren</DialogTitle>
          <DialogDescription>
            Die Krankmeldung vom {formatSicknessRange(report)} wird storniert und zählt nicht mehr als
            Abwesenheit.
          </DialogDescription>
        </DialogHeader>
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
            Abbrechen
          </Button>
          <Button
            pending={isSaving}
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={isSaving}
          >
            {isSaving ? 'Wird storniert…' : 'Stornieren'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
