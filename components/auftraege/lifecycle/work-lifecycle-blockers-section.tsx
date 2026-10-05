'use client';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { InlinePending } from '@/components/ui/inline-pending';
import { WORK_BLOCKER_REASON_LABELS, type WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import type { WorkLifecycleDialogState } from './work-lifecycle-dialog-state';

function formatReviewDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('de-DE').format(new Date(`${value}T00:00:00`)) : 'Ohne Datum';
}

type WorkLifecycleBlockersSectionProps = {
  snapshot: WorkLifecycleSnapshot;
  isManager: boolean;
  readOnly: boolean;
  ownerNames: Map<string, string>;
  ownOwnerId: string | null;
  rowBusy: { isBusy: (id: string) => boolean };
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
};

export function WorkLifecycleBlockersSection({
  snapshot,
  isManager,
  readOnly,
  ownerNames,
  ownOwnerId,
  rowBusy,
  setDialog,
}: WorkLifecycleBlockersSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Blocker & Parkplatz</h3>
        {!readOnly && (isManager || snapshot.targetType === 'job') && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ type: 'blocker' })}>
            <Plus className="size-4" />
            Blocker hinzufügen
          </Button>
        )}
      </div>
      {snapshot.blockers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine offenen Blocker.</p>
      ) : (
        snapshot.blockers.map((blocker) => (
          <div key={blocker.id} className="rounded-md border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {blocker.kind === 'parking'
                    ? 'Geparkt'
                    : blocker.reason
                      ? WORK_BLOCKER_REASON_LABELS[blocker.reason]
                      : 'Kontext fehlt (Altbestand)'}
                </p>
                <p className="text-muted-foreground">
                  {blocker.details || 'Kein nächster Schritt beschrieben.'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Verantwortlich:{' '}
                  {blocker.responsible_employee_record_id
                    ? (ownerNames.get(blocker.responsible_employee_record_id) ?? 'Unbekannt')
                    : 'nicht hinterlegt'}{' '}
                  · Wiedervorlage: {formatReviewDate(blocker.next_review_date)}
                </p>
              </div>
              {!readOnly &&
                (isManager ||
                  (blocker.kind === 'blocker' &&
                    ownOwnerId !== null &&
                    blocker.responsible_employee_record_id === ownOwnerId)) && (
                  <div className="flex items-center gap-1">
                    <InlinePending active={rowBusy.isBusy(blocker.id)} label="Blocker wird aktualisiert" />
                    {blocker.kind === 'parking' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={rowBusy.isBusy(blocker.id)}
                        onClick={() => setDialog({ type: 'unpark', blocker })}
                      >
                        Weiterplanen
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={rowBusy.isBusy(blocker.id)}
                          onClick={() => setDialog({ type: 'blocker', blocker })}
                        >
                          Bearbeiten
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={rowBusy.isBusy(blocker.id)}
                          onClick={() => setDialog({ type: 'resolve-blocker', blocker })}
                        >
                          Lösen
                        </Button>
                      </>
                    )}
                  </div>
                )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

type WorkLifecycleResolvedBlockersProps = {
  snapshot: WorkLifecycleSnapshot;
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
};

export function WorkLifecycleResolvedBlockers({ snapshot, setDialog }: WorkLifecycleResolvedBlockersProps) {
  return (
    <FormDisclosure label="Gelöste Blocker">
      <div className="space-y-2 pt-3">
        {snapshot.resolvedBlockers.map((blocker) => (
          <div
            key={blocker.id}
            className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium">
                {blocker.reason ? WORK_BLOCKER_REASON_LABELS[blocker.reason] : 'Gelöster Altbestand'}
              </p>
              <p className="text-muted-foreground">{blocker.resolution_note || 'Ohne Lösungsnotiz'}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDialog({ type: 'reopen-blocker', blocker })}
            >
              Wieder öffnen
            </Button>
          </div>
        ))}
      </div>
    </FormDisclosure>
  );
}
