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
import { useOrganization } from '@/components/organization/organization-context';
import { isManagerRole } from '@/lib/roles';
import type { ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
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
  /** The organization's closed periods: a time in one is marked before the request. */
  closedPeriods: readonly ClosedTimePeriod[];
};

/** „Korrigieren“ on an entry, „Zeit nachtragen“ without one. */
function TimeCorrectionTrigger({ entry }: { entry: TimeEntry | undefined }) {
  return (
    <DialogTrigger asChild>
      <Button variant={entry ? 'ghost' : 'outline'} size="sm">
        {entry ? <Pencil className="mr-1.5 size-4" /> : <Plus className="mr-1.5 size-4" />}
        {entry ? 'Korrigieren' : 'Zeit nachtragen'}
      </Button>
    </DialogTrigger>
  );
}

/** The sentence about other people's time applies to Admin and Büro only. */
function TimeCorrectionDescription() {
  const { activeOrg } = useOrganization();
  return (
    <DialogDescription>
      {activeOrg !== null && isManagerRole(activeOrg.role)
        ? 'Eigene Änderungen gehen zur Prüfung. Freigabeberechtigte können Zeiten anderer Personen direkt korrigieren.'
        : 'Deine Änderung geht zur Prüfung.'}
    </DialogDescription>
  );
}

export function TimeCorrectionDialog({
  organizationId,
  entry,
  onSubmitted,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  closedPeriods,
}: CorrectionDialogProps) {
  const correctionFormId = useId();
  const form = useTimeCorrectionDialogForm({
    organizationId,
    entry,
    onSubmitted,
    controlledOpen,
    onOpenChange,
    closedPeriods,
  });
  const { open, setOpen, options, loadingOptions, submitting, kind, submit } = form;

  const correctionContent = <TimeCorrectionDialogFields entry={entry} form={form} />;

  return (
    <Dialog open={open} onOpenChange={setOpen} pending={submitting}>
      {!hideTrigger ? <TimeCorrectionTrigger entry={entry} /> : null}
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Zeitkorrektur</DialogTitle>
          <TimeCorrectionDescription />
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
