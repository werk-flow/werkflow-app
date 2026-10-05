'use client';

import Link from 'next/link';
import { CalendarClock, Check, ExternalLink, Pencil, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { InlinePending } from '@/components/ui/inline-pending';
import { isFollowUpOverdue } from '@/lib/customer-relationships/resolution';
import type { ClientFollowUp } from '@/lib/customer-relationships/types';
import { FOLLOW_UP_LIST_ID } from './use-follow-up-editor';
import { formatBerlinDateTime } from '@/lib/utils';

interface FollowUpsSectionProps {
  openFollowUps: ClientFollowUp[];
  historicFollowUps: ClientFollowUp[];
  /** The follow-up a task link points at (`?followUp=`), highlighted in the list. */
  focusedFollowUpId: string | null;
  isBusy: (id: string) => boolean;
  onCreateFollowUp: () => void;
  onEditFollowUp: (followUp: ClientFollowUp) => void;
  onTransitionFollowUp: (followUp: ClientFollowUp, status: 'completed' | 'cancelled') => void;
}

export function FollowUpsSection({
  openFollowUps,
  historicFollowUps,
  focusedFollowUpId,
  isBusy,
  onCreateFollowUp,
  onEditFollowUp,
  onTransitionFollowUp,
}: FollowUpsSectionProps) {
  return (
    <section id="nachfassaktionen" className="scroll-mt-4 space-y-3" aria-labelledby="follow-ups-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="follow-ups-heading" className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-muted-foreground" />
            Nachfassaktionen
            <InlinePending active={isBusy(FOLLOW_UP_LIST_ID)} />
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Sichtbare nächste Schritte mit Zuständigkeit und Fälligkeit.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={onCreateFollowUp}>
          <Plus className="size-3.5" />
          Nachfassaktion anlegen
        </Button>
      </div>

      {openFollowUps.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          Keine offenen Nachfassaktionen.
        </p>
      ) : (
        <div className="divide-y rounded-lg border bg-card" data-testid="customer-follow-ups">
          {openFollowUps.map((followUp) => {
            const overdue = isFollowUpOverdue(followUp.dueAt, followUp.status);
            return (
              <article
                key={followUp.id}
                className={`space-y-2 px-4 py-3 ${focusedFollowUpId === followUp.id ? 'bg-muted/60' : ''}`}
                data-follow-up-id={followUp.id}
                data-overdue={overdue ? 'true' : 'false'}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{followUp.title}</p>
                      <InlinePending active={isBusy(followUp.id)} />
                      {overdue && (
                        <Badge
                          variant="outline"
                          className="border-warning/40 bg-warning-soft text-warning-soft-foreground"
                        >
                          Überfällig
                        </Badge>
                      )}
                      {!followUp.ownerIsActiveManager && <Badge variant="outline">Neu zuweisen</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {followUp.ownerName} · fällig {formatBerlinDateTime(followUp.dueAt)}
                    </p>
                    {followUp.note && <p className="mt-2 text-sm text-muted-foreground">{followUp.note}</p>}
                    {followUp.sourceLabel &&
                      (followUp.sourceHref ? (
                        <Link
                          href={followUp.sourceHref}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-primary-text hover:underline"
                        >
                          Quelle: {followUp.sourceLabel}
                          <ExternalLink className="size-3" />
                        </Link>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">Quelle: {followUp.sourceLabel}</p>
                      ))}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onEditFollowUp(followUp)}
                      aria-label={`Nachfassaktion ${followUp.title} bearbeiten`}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={isBusy(followUp.id)}
                      onClick={() => onTransitionFollowUp(followUp, 'completed')}
                      aria-label={`Nachfassaktion ${followUp.title} erledigen`}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={isBusy(followUp.id)}
                      onClick={() => onTransitionFollowUp(followUp, 'cancelled')}
                      aria-label={`Nachfassaktion ${followUp.title} abbrechen`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {historicFollowUps.length > 0 && (
        <FormDisclosure
          className="rounded-md border px-3 py-2"
          label={`Abgeschlossene und abgebrochene Nachfassaktionen (${historicFollowUps.length})`}
        >
          <div className="divide-y">
            {historicFollowUps.map((followUp) => (
              <div key={followUp.id} className="py-2 text-sm">
                <p className="font-medium">{followUp.title}</p>
                <p className="text-xs text-muted-foreground">
                  {followUp.status === 'completed' ? 'Erledigt' : 'Abgebrochen'} ·{' '}
                  {formatBerlinDateTime(followUp.completedAt ?? followUp.cancelledAt ?? followUp.updatedAt)}
                </p>
                {followUp.resolutionNote && (
                  <p className="mt-1 text-xs text-muted-foreground">{followUp.resolutionNote}</p>
                )}
              </div>
            ))}
          </div>
        </FormDisclosure>
      )}
    </section>
  );
}
