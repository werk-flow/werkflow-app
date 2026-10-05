'use client';

import { CalendarCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  formatSicknessRange,
  SICKNESS_EVIDENCE_LABELS,
  SICKNESS_TYPE_LABELS,
  type SicknessReport,
} from '@/lib/sickness/types';
import { cn } from '@/lib/utils';

type OwnSicknessReportListProps = {
  activeReports: SicknessReport[];
  pastReports: SicknessReport[];
  settling: { isBusy: (id: string) => boolean };
  setEndReport: (report: SicknessReport) => void;
  setCancelReport: (report: SicknessReport) => void;
};

export function OwnSicknessReportList({
  activeReports,
  pastReports,
  settling,
  setEndReport,
  setCancelReport,
}: OwnSicknessReportListProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <h4 className="mb-2 text-sm font-medium">Meine Krankmeldungen</h4>
        <ul className="grid gap-2">
          {[...activeReports, ...pastReports].map((report) => (
            <li key={report.id} className="rounded-md border px-3 py-2.5">
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
                    <InlinePending active={settling.isBusy(report.id)} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {SICKNESS_TYPE_LABELS[report.absenceType]}
                    {report.dayPortion === 'half_day' ? ' · Halbtägig' : ''}
                    {report.evidenceRequired ? ` · ${SICKNESS_EVIDENCE_LABELS[report.evidenceStatus]}` : ''}
                  </p>
                </div>
                {report.status === 'reported' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setEndReport(report)}
                      disabled={settling.isBusy(report.id)}
                      aria-label={`Enddatum für die Krankmeldung vom ${formatSicknessRange(report)} setzen`}
                    >
                      <CalendarCheck className="size-3.5" />
                      {report.endDate === null ? 'Enddatum setzen' : 'Enddatum ändern'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => setCancelReport(report)}
                      disabled={settling.isBusy(report.id)}
                      aria-label={`Krankmeldung vom ${formatSicknessRange(report)} stornieren`}
                    >
                      Stornieren
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
