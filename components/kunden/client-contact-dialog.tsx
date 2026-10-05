'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CONTACT_ROLE_SUGGESTIONS } from '@/lib/clients/types';

import type { ContactDialogState } from './client-relation-drafts';

interface ClientContactDialogProps {
  /** Null while the dialog is closed; the parent keeps the draft. */
  contactDialog: ContactDialogState | null;
  onContactDialogChange: (next: ContactDialogState | null) => void;
  onSave: () => void;
}

export function ClientContactDialog({
  contactDialog,
  onContactDialogChange,
  onSave,
}: ClientContactDialogProps) {
  return (
    <Dialog open={contactDialog !== null} onOpenChange={(open) => !open && onContactDialogChange(null)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {contactDialog?.contactId ? 'Ansprechpartner bearbeiten' : 'Ansprechpartner hinzufügen'}
          </DialogTitle>
          <DialogDescription>
            Ansprechpartner gehören zu diesem Kunden und können Aufträgen zugeordnet werden.
          </DialogDescription>
        </DialogHeader>
        {contactDialog && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
            noValidate
            className="grid gap-4"
          >
            <Field label="Name" htmlFor="contact-name" required error={contactDialog.nameError}>
              <Input
                value={contactDialog.draft.name}
                onChange={(e) =>
                  onContactDialogChange({
                    ...contactDialog,
                    draft: { ...contactDialog.draft, name: e.target.value },
                    error: null,
                    nameError: null,
                  })
                }
                placeholder="z. B. Sabine Krause"
              />
            </Field>
            <Field label="Rolle" htmlFor="contact-role">
              <Input
                value={contactDialog.draft.role ?? ''}
                onChange={(e) =>
                  onContactDialogChange({
                    ...contactDialog,
                    draft: { ...contactDialog.draft, role: e.target.value },
                  })
                }
                list="contact-role-suggestions"
                placeholder="z. B. Hausverwaltung"
              />
              <datalist id="contact-role-suggestions">
                {CONTACT_ROLE_SUGGESTIONS.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Telefon" htmlFor="contact-phone">
                <Input
                  value={contactDialog.draft.phone ?? ''}
                  onChange={(e) =>
                    onContactDialogChange({
                      ...contactDialog,
                      draft: {
                        ...contactDialog.draft,
                        phone: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="E-Mail" htmlFor="contact-email">
                <Input
                  type="text"
                  inputMode="email"
                  value={contactDialog.draft.email ?? ''}
                  onChange={(e) =>
                    onContactDialogChange({
                      ...contactDialog,
                      draft: {
                        ...contactDialog.draft,
                        email: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Notizen" htmlFor="contact-notes">
              <Textarea
                value={contactDialog.draft.notes ?? ''}
                onChange={(e) =>
                  onContactDialogChange({
                    ...contactDialog,
                    draft: { ...contactDialog.draft, notes: e.target.value },
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={contactDialog.draft.isPrimary ?? false}
                onCheckedChange={(checked) =>
                  onContactDialogChange({
                    ...contactDialog,
                    draft: {
                      ...contactDialog.draft,
                      isPrimary: checked === true,
                    },
                  })
                }
              />
              Als Hauptkontakt festlegen
            </label>
            <ErrorText>{contactDialog.error}</ErrorText>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onContactDialogChange(null)}>
                Abbrechen
              </Button>
              <Button type="submit">Speichern</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
