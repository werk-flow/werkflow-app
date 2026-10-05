'use client';

import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type ContextualDocumentsRenameFormProps = {
  value: string;
  error: string | null;
  isPending: boolean;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/** Body and footer of the rename dialog of a contextual document list. */
export function ContextualDocumentsRenameForm({
  value,
  error,
  isPending,
  onValueChange,
  onCancel,
  onSubmit,
}: ContextualDocumentsRenameFormProps): ReactElement {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isPending) return;
        onSubmit();
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <DialogBody>
        <Field label="Dateiname" htmlFor="contextual-document-name" required error={error}>
          <Input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="Dateiname"
            autoFocus
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Umbenennen
        </Button>
      </DialogFooter>
    </form>
  );
}
