'use client';

import { CalendarClock, ClipboardCopy, MapPin, Navigation, Phone, UserRound } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';

import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useBanner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { FieldWorkPackJob } from '@/lib/jobs/field-work-pack';
import { JOB_PRIORITY_LABELS } from '@/lib/jobs/types';

function formatSchedule(job: FieldWorkPackJob): string {
  if (!job.plannedDate) return 'Noch kein Termin geplant';
  const [year, month, day] = job.plannedDate.split('-');
  const time = job.plannedTime ? `, ${job.plannedTime.slice(0, 5)} Uhr` : '';
  return `${day}.${month}.${year}${time}`;
}

function formatDuration(minutes: number | null): string | null {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours > 0 ? `${hours} Std.` : null, rest > 0 ? `${rest} Min.` : null]
    .filter(Boolean)
    .join(' ');
}

export function FieldWorkPackOverview({ job }: { job: FieldWorkPackJob }): ReactElement {
  const { showBanner } = useBanner();
  const overviewRef = useRef<HTMLElement>(null);
  const phone = job.contactPhone ?? job.customerPhone;
  const telephoneHref = phone
    ? `${phone.trimStart().startsWith('+') ? '+' : ''}${phone.replace(/\D/g, '')}`
    : null;
  const duration = formatDuration(job.plannedWorkingMinutes);

  useRealtimeRouterRefresh({
    debounceMs: 150,
    tables: [
      'jobs',
      'projects',
      'job_assignments',
      'clients',
      'client_contacts',
      'client_sites',
      'job_instruction_items',
      'job_material_lines',
      'inventory_stock_levels',
      'inventory_movements',
      'documents',
      'document_links',
    ],
  });

  useEffect(() => {
    overviewRef.current?.setAttribute('data-realtime-ready', 'true');
  }, []);

  async function copyAddress(): Promise<void> {
    if (!job.siteAddress) return;
    try {
      await navigator.clipboard.writeText(job.siteAddress);
      showBanner({ variant: 'success', message: 'Die Adresse wurde kopiert.' });
    } catch {
      showBanner({ variant: 'error', message: 'Die Adresse konnte nicht kopiert werden.' });
    }
  }

  return (
    <section
      ref={overviewRef}
      className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
      aria-labelledby="field-overview-heading"
      data-testid="field-work-pack-overview"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="field-overview-heading" className="text-base font-semibold">Vor dem Einsatz</h2>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Kunde, Einsatzort und Arbeitsziel auf einen Blick.</p>
        </div>
        <Badge variant="outline" className="shrink-0">Priorität {JOB_PRIORITY_LABELS[job.priority]}</Badge>
      </div>

      <div className="mt-3 grid gap-3 sm:mt-4 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-3">
          <div className="flex gap-3">
            <CalendarClock className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Termin</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums">{formatSchedule(job)}</p>
              {duration && <p className="text-xs text-muted-foreground">Geplant: {duration}</p>}
            </div>
          </div>
          <div className="flex gap-3" data-testid="field-work-pack-contact">
            <UserRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kontakt</p>
              <p className="mt-0.5 text-sm font-medium">{job.contactName ?? job.customerName ?? 'Nicht hinterlegt'}</p>
              {job.contactRole && <p className="text-xs text-muted-foreground">{job.contactRole}</p>}
              {job.contactName && job.customerName && <p className="text-xs text-muted-foreground">{job.customerName}</p>}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Einsatzort</p>
              <p className="mt-0.5 text-sm font-medium">{job.siteName ?? 'Einsatzort'}</p>
              <p className="text-sm text-muted-foreground">{job.siteAddress ?? 'Keine Adresse hinterlegt'}</p>
              {job.accessNotes && <p className="mt-1 text-sm"><span className="font-medium">Zugang:</span> {job.accessNotes}</p>}
            </div>
          </div>
        </div>
      </div>

      {job.requestedOutcome && (
        <div className="mt-3 border-t pt-3 sm:mt-4 sm:pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Arbeitsziel</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{job.requestedOutcome}</p>
        </div>
      )}

      <div className="mt-3 flex gap-2 border-t pt-3 sm:mt-4 sm:pt-4">
        {phone && (
          <Button asChild className="min-h-11 min-w-0 flex-1 px-2 sm:flex-none sm:px-4">
            <a href={`tel:${telephoneHref}`} aria-label={`${job.contactName ?? job.customerName ?? 'Kontakt'} anrufen`}>
              <Phone className="size-4" />
              Anrufen
            </a>
          </Button>
        )}
        {job.siteAddress && (
          <>
            <Button asChild variant={phone ? 'outline' : 'default'} className="min-h-11 min-w-0 flex-1 px-2 sm:flex-none sm:px-4">
              <a href={`geo:0,0?q=${encodeURIComponent(job.siteAddress)}`} aria-label={`Navigation zu ${job.siteAddress} öffnen`}>
                <Navigation className="size-4" />
                Route
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-0 flex-1 px-2 sm:flex-none sm:px-4"
              aria-label="Adresse kopieren"
              onClick={() => void copyAddress()}
            >
              <ClipboardCopy className="size-4" />
              Adresse
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
