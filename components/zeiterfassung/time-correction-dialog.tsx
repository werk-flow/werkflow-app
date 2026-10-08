'use client';

import { useId } from 'react';
import { Pencil, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { TimeCorrectionDialogFields } from './time-correction-dialog-fields';
import { useTimeCorrectionDialogForm } from './use-time-correction-dialog';

type CorrectionDialogProps = {
  organizationId: string;
  entry?: TimeEntry | undefined;
  onSubmitted?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

export function TimeCorrectionDialog({
  organizationId,
  entry,
  onSubmitted,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: CorrectionDialogProps) {
  const correctionFormId = useId();
  const form = useTimeCorrectionDialogForm({
    organizationId,
    entry,
    onSubmitted,
    controlledOpen,
    onOpenChange,
  });
  const { open, setOpen, options, loadingOptions, submitting, kind, submit } = form;

  const correctionContent = <TimeCorrectionDialogFields entry={entry} form={form} />;

  return (
    <Dialog open={open} onOpenChange={setOpen} pending={submitting}>
      {!hideTrigger ? (
        <DialogTrigger asChild>
          <Button variant={entry ? 'ghost' : 'outline'} size="sm">
            {entry ? <Pencil className="mr-1.5 size-4" /> : <Plus className="mr-1.5 size-4" />}
            {entry ? 'Korrigieren' : 'Zeit nachtragen'}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Zeitkorrektur</DialogTitle>
          <DialogDescription>
            Eigene Änderungen gehen zur Prüfung. Freigabeberechtigte können Zeiten anderer Personen direkt
            korrigieren.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {kind !== 'delete' ? (
            <form
              id={correctionFormId}
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (loadingOptions || submitting || !options) return;
                void submit();
              }}
              noValidate
              className="space-y-4"
            >
              {correctionContent}
            </form>
          ) : (
            correctionContent
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Abbrechen
          </Button>
          {kind === 'delete' ? (
            <Button
              pending={submitting}
              type="button"
              onClick={() => void submit()}
              disabled={loadingOptions || submitting || !options}
            >
              Speichern
            </Button>
          ) : (
            <Button
              pending={submitting}
              type="submit"
              form={correctionFormId}
              // eslint-disable-next-line ui/submit-disabled-only-while-pending -- the form options have not loaded, so there is nothing to submit yet
              disabled={loadingOptions || submitting || !options}
            >
              Speichern
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
