'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { WORK_BLOCKER_REASON_LABELS, type WorkBlockerReason } from '@/lib/work-lifecycle/types';
import { useWorkLifecycleBlockerForm, type WorkBlockerDialogProps } from './use-work-lifecycle-blocker-form';

export function WorkBlockerDialog(props: WorkBlockerDialogProps) {
  const { snapshot, kind, blocker, isManager, onClose } = props;
  const {
    reason,
    setReason,
    details,
    setDetails,
    ownerId,
    setOwnerId,
    reviewDate,
    setReviewDate,
    error,
    pending,
    submit,
  } = useWorkLifecycleBlockerForm(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={pending}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>
              {kind === 'parking' ? 'Arbeit parken' : blocker ? 'Blocker bearbeiten' : 'Blocker erfassen'}
            </DialogTitle>
            <DialogDescription>
              Grund, Zuständigkeit und nächster Prüftermin bleiben sichtbar, bis der Eintrag begründet gelöst
              wird.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Grund" htmlFor="work-blocker-reason" required>
              {/* Ten reasons: at or above ten options the registry requires a searchable control. */}
              <SearchableSelect
                options={Object.entries(WORK_BLOCKER_REASON_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                value={reason}
                onChange={(value) => setReason(value as WorkBlockerReason)}
                searchPlaceholder="Grund suchen"
                emptyMessage="Kein passender Grund gefunden"
              />
            </Field>
            <Field
              label="Nächster Schritt / Details"
              htmlFor="work-blocker-details"
              required={reason === 'other'}
            >
              <Textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={2000}
                placeholder="Was muss als Nächstes passieren?"
              />
            </Field>
            <Field label="Verantwortlich" htmlFor="work-blocker-owner" required>
              <SearchableSelect
                options={snapshot.ownerOptions}
                value={ownerId}
                onChange={setOwnerId}
                placeholder="Person auswählen"
                searchPlaceholder="Person suchen…"
                emptyMessage="Keine Person gefunden"
              />
            </Field>
            {isManager ? (
              <Field label="Wiedervorlage" htmlFor="work-blocker-review" required>
                <DatePicker ariaLabel="Wiedervorlagedatum" value={reviewDate} onChange={setReviewDate} />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">Die Wiedervorlage wird auf heute gesetzt.</p>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
