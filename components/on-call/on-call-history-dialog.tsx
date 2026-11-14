'use client';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OnCallPerson, OnCallShift } from '@/lib/on-call/types';
import { formatBerlinDateTime } from '@/lib/utils';

import { HISTORY_KIND_LABELS, shiftSpanLabel } from './on-call-labels';

/** Every version of one shift, oldest first: who changed what, and the state after it. */
export function OnCallHistoryDialog({
  shift,
  people,
  onClose,
}: {
  shift: OnCallShift;
  people: readonly OnCallPerson[];
  onClose: () => void;
}): ReactElement {
  const nameOf = new Map(people.map((person) => [person.employeeRecordId, person.name]));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verlauf der Bereitschaft</DialogTitle>
          <DialogDescription>Jede Änderung bleibt mit ihrem Stand erhalten.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ol className="divide-y">
            {shift.history.map((entry) => (
              <li key={`${entry.version}-${entry.kind}`} className="space-y-1 py-3 text-sm">
                <p className="font-medium">
                  {HISTORY_KIND_LABELS[entry.kind]}
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {formatBerlinDateTime(entry.createdAt)} · {entry.actorName}
                  </span>
                </p>
                <p className="tabular-nums">{shiftSpanLabel(entry)}</p>
                <p>
                  {entry.memberIds.map((id) => nameOf.get(id) ?? 'Unbekannt').join(', ')}
                  {entry.label ? ` · ${entry.label}` : ''}
                </p>
                {entry.handoverNote && (
                  <p className="whitespace-pre-line text-muted-foreground">{entry.handoverNote}</p>
                )}
              </li>
            ))}
          </ol>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
