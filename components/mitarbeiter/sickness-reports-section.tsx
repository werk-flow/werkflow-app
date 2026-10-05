'use client';

import { useCallback, useState } from 'react';
import { CalendarCheck, FileCheck, MoreVertical, Pencil, Plus, Thermometer, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SectionError } from '@/components/ui/section-error';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  formatSicknessRange,
  SICKNESS_EVIDENCE_LABELS,
  SICKNESS_TYPE_LABELS,
  type SicknessReport,
} from '@/lib/sickness/types';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { cn } from '@/lib/utils';

import { CorrectSicknessDialog } from './sickness-report-correct-dialog';
import { EvidenceDialog, ManagerCancelDialog, ManagerEndDialog } from './sickness-report-manager-dialogs';
import { RecordSicknessDialog } from './sickness-report-record-dialog';
import { SectionTitle } from '@/components/shared/section-title';

// Manager surface (privacy matrix): admin/büro see type and evidence state
// here — the shared calendar stays neutral. There is deliberately no note
// field and nothing that could hold a diagnosis.

type DialogState =
  | { mode: 'closed' }
  | { mode: 'record' }
  | { mode: 'end'; report: SicknessReport }
  | { mode: 'correct'; report: SicknessReport }
  | { mode: 'evidence'; report: SicknessReport }
  | { mode: 'cancel'; report: SicknessReport };

export function SicknessReportsSection({ recordId }: { recordId: string }) {
  const [dialogState, setDialogState] = useState<DialogState>({
    mode: 'closed',
  });

  const view = useLiveView<SicknessReport[]>({
    tables: ['sickness_reports'],
    read: async ({ signal }): Promise<LiveViewResult<SicknessReport[]>> => {
      const result = await readInBackground(
        'sickness-reports-for-record',
        { employeeRecordId: recordId },
        signal,
      );
      return result.success ? { ok: true, data: result.reports } : { ok: false };
    },
    resetKey: recordId,
  });
  const { refresh } = view;

  const closeDialog = useCallback(
    (saved: boolean) => {
      setDialogState({ mode: 'closed' });
      if (saved) void refresh();
    },
    [refresh],
  );

  const sorted = [...(view.data ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <section className="space-y-3" data-testid="sickness-reports-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={<Thermometer className="size-4" />}>Krankmeldungen</SectionTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setDialogState({ mode: 'record' })}
        >
          <Plus className="size-3.5" />
          Krankmeldung erfassen
        </Button>
      </div>

      {view.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : view.data === undefined ? (
        <SectionError onRetry={() => void refresh()} retryPending={view.isRefreshing}>
          Die Krankmeldungen konnten nicht geladen werden.
        </SectionError>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Krankmeldungen erfasst.</p>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((report) => (
            <SicknessReportRow key={report.id} report={report} setDialogState={setDialogState} />
          ))}
        </ul>
      )}

      {dialogState.mode === 'record' && <RecordSicknessDialog recordId={recordId} onClose={closeDialog} />}
      {dialogState.mode === 'end' && <ManagerEndDialog report={dialogState.report} onClose={closeDialog} />}
      {dialogState.mode === 'correct' && (
        <CorrectSicknessDialog report={dialogState.report} onClose={closeDialog} />
      )}
      {dialogState.mode === 'evidence' && (
        <EvidenceDialog report={dialogState.report} onClose={closeDialog} />
      )}
      {dialogState.mode === 'cancel' && (
        <ManagerCancelDialog report={dialogState.report} onClose={closeDialog} />
      )}
    </section>
  );
}

function SicknessReportRow({
  report,
  setDialogState,
}: {
  report: SicknessReport;
  setDialogState: (state: DialogState) => void;
}) {
  return (
    <li className="rounded-md border px-3 py-2.5" data-sickness-report={report.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tabular-nums">{formatSicknessRange(report)}</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                report.status === 'reported'
                  ? 'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {report.status === 'reported' ? 'Aktiv' : 'Storniert'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {SICKNESS_TYPE_LABELS[report.absenceType]}
            {report.dayPortion === 'half_day' ? ' · Halbtägig' : ''}
            {` · ${SICKNESS_EVIDENCE_LABELS[report.evidenceStatus]}`}
          </p>
          {report.status === 'cancelled' && report.cancellationReason && (
            <p className="mt-1 text-xs text-muted-foreground">Storniert: {report.cancellationReason}</p>
          )}
        </div>
        {report.status === 'reported' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Aktionen für die Krankmeldung vom ${formatSicknessRange(report)}`}
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialogState({ mode: 'end', report })}>
                <CalendarCheck className="size-4" />
                {report.endDate === null ? 'Enddatum setzen' : 'Enddatum ändern'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialogState({ mode: 'correct', report })}>
                <Pencil className="size-4" />
                Korrigieren
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialogState({ mode: 'evidence', report })}>
                <FileCheck className="size-4" />
                Nachweis verwalten
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDialogState({ mode: 'cancel', report })}
              >
                <XCircle className="size-4" />
                Stornieren
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}
