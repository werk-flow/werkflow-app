'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DateTimeField } from '@/components/ui/date-time-field';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { CustomerRelationshipBundle } from '@/lib/customer-relationships/types';
import type { FollowUpDraft } from './use-follow-up-editor';

interface CustomerFollowUpDialogProps {
  /** Null while the dialog is closed; the parent keeps the draft. */
  followUpDraft: FollowUpDraft | null;
  followUpOwners: CustomerRelationshipBundle['followUpOwners'];
  followUpError: string | null;
  followUpTitleError: string | undefined;
  followUpOwnerError: string | undefined;
  followUpDueError: string | undefined;
  isPending: boolean;
  onDraftChange: (draft: FollowUpDraft) => void;
  onSave: () => void;
  onClose: () => void;
}

export function CustomerFollowUpDialog({
  followUpDraft,
  followUpOwners,
  followUpError,
  followUpTitleError,
  followUpOwnerError,
  followUpDueError,
  isPending,
  onDraftChange,
  onSave,
  onClose,
}: CustomerFollowUpDialogProps) {
  return (
    <Dialog
      open={followUpDraft !== null}
      pending={isPending}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {followUpDraft?.id ? 'Nachfassaktion bearbeiten' : 'Nachfassaktion anlegen'}
          </DialogTitle>
          <DialogDescription>
            Lege einen klaren nächsten Schritt mit Zuständigkeit und genauer Fälligkeit fest.
          </DialogDescription>
        </DialogHeader>
        {followUpDraft && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
            noValidate
            className="space-y-4"
          >
            {followUpDraft.sourceLabel && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">Quelle: {followUpDraft.sourceLabel}</p>
            )}
            <Field label="Titel" htmlFor="follow-up-title" required error={followUpTitleError}>
              <Input
                value={followUpDraft.title}
                onChange={(event) => onDraftChange({ ...followUpDraft, title: event.target.value })}
                maxLength={160}
                autoFocus
              />
            </Field>
            <Field label="Zuständig" htmlFor="follow-up-owner" required error={followUpOwnerError}>
              <SearchableSelect
                options={followUpOwners.map((owner) => ({
                  value: owner.userId,
                  label: owner.name,
                }))}
                value={followUpDraft.ownerUserId}
                onChange={(value) => onDraftChange({ ...followUpDraft, ownerUserId: value })}
                placeholder="Person wählen"
                searchPlaceholder="Person suchen…"
                emptyMessage="Keine Person gefunden"
              />
            </Field>
            <Field label="Fällig am" htmlFor="follow-up-due-date" required error={followUpDueError}>
              <DateTimeField
                idPrefix="follow-up-due"
                value={followUpDraft.dueAt}
                onChange={(value) => onDraftChange({ ...followUpDraft, dueAt: value })}
                dateAriaLabel="Fälligkeitsdatum"
                invalid={Boolean(followUpDueError)}
              />
            </Field>
            <Field label="Notiz" htmlFor="follow-up-note">
              <Textarea
                value={followUpDraft.note}
                onChange={(event) => onDraftChange({ ...followUpDraft, note: event.target.value })}
                maxLength={2000}
              />
            </Field>
            <ErrorText>{followUpError}</ErrorText>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Speichern
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
