'use client';

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
  const form = useWorkLifecycleBlockerForm(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={form.pending}
    >
      <DialogContent>
        <form onSubmit={form.submit} className="contents" noValidate>
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
                value={form.reason}
                onChange={(value) => form.setReason(value as WorkBlockerReason)}
                searchPlaceholder="Grund suchen"
                emptyMessage="Kein passender Grund gefunden"
              />
            </Field>
            <Field
              label="Nächster Schritt / Details"
              htmlFor="work-blocker-details"
              required={form.reason === 'other'}
              error={form.errors.details}
            >
              <Textarea
                value={form.details}
                onChange={(event) => form.setDetails(event.target.value)}
                maxLength={2000}
                placeholder="Was muss als Nächstes passieren?"
              />
            </Field>
            <Field label="Verantwortlich" htmlFor="work-blocker-owner" required error={form.errors.owner}>
              <SearchableSelect
                options={snapshot.ownerOptions}
                value={form.ownerId}
                onChange={form.setOwnerId}
                placeholder="Person auswählen"
                searchPlaceholder="Person suchen…"
                emptyMessage="Keine Person gefunden"
              />
            </Field>
            {isManager ? (
              <Field label="Wiedervorlage" htmlFor="work-blocker-review" required error={form.errors.review}>
                <DatePicker
                  ariaLabel="Wiedervorlagedatum"
                  value={form.reviewDate}
                  onChange={form.setReviewDate}
                />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">Die Wiedervorlage wird auf heute gesetzt.</p>
            )}
            <ErrorText>{form.error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={form.pending}>
              Abbrechen
            </Button>
            <Button pending={form.pending} type="submit" disabled={form.pending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
