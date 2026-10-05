'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { ClientContact } from '@/lib/clients/types';

import type { SiteDialogState } from './client-relation-drafts';

interface ClientSiteDialogProps {
  /** Null while the dialog is closed; the parent keeps the draft. */
  siteDialog: SiteDialogState | null;
  contacts: ClientContact[];
  onSiteDialogChange: (next: SiteDialogState | null) => void;
  onSave: () => void;
}

function ClientSiteAddressFields({
  siteDialog,
  onSiteDialogChange,
}: {
  siteDialog: SiteDialogState;
  onSiteDialogChange: (next: SiteDialogState | null) => void;
}) {
  return (
    <>
      <Field label="Straße und Hausnummer" htmlFor="site-street">
        <Input
          value={siteDialog.draft.street ?? ''}
          onChange={(e) =>
            onSiteDialogChange({
              ...siteDialog,
              draft: { ...siteDialog.draft, street: e.target.value },
            })
          }
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <Field label="PLZ" htmlFor="site-postal-code">
          <Input
            inputMode="numeric"
            value={siteDialog.draft.postalCode ?? ''}
            onChange={(e) =>
              onSiteDialogChange({
                ...siteDialog,
                draft: {
                  ...siteDialog.draft,
                  postalCode: e.target.value,
                },
              })
            }
          />
        </Field>
        <Field label="Ort" htmlFor="site-city">
          <Input
            value={siteDialog.draft.city ?? ''}
            onChange={(e) =>
              onSiteDialogChange({
                ...siteDialog,
                draft: { ...siteDialog.draft, city: e.target.value },
              })
            }
          />
        </Field>
      </div>
    </>
  );
}

export function ClientSiteDialog({
  siteDialog,
  contacts,
  onSiteDialogChange,
  onSave,
}: ClientSiteDialogProps) {
  return (
    <Dialog open={siteDialog !== null} onOpenChange={(open) => !open && onSiteDialogChange(null)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{siteDialog?.siteId ? 'Einsatzort bearbeiten' : 'Einsatzort hinzufügen'}</DialogTitle>
          <DialogDescription>
            Ein Einsatzort ist ein dauerhafter Arbeitsort dieses Kunden, z. B. ein Gebäude oder eine Wohnung.
          </DialogDescription>
        </DialogHeader>
        {siteDialog && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
            noValidate
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogBody className="grid gap-4 py-1">
              <Field label="Bezeichnung" htmlFor="site-name" required error={siteDialog.nameError}>
                <Input
                  value={siteDialog.draft.name}
                  onChange={(e) =>
                    onSiteDialogChange({
                      ...siteDialog,
                      draft: { ...siteDialog.draft, name: e.target.value },
                      error: null,
                      nameError: null,
                    })
                  }
                  placeholder="z. B. Hauptgebäude, Wohnung 3. OG"
                />
              </Field>
              <ClientSiteAddressFields siteDialog={siteDialog} onSiteDialogChange={onSiteDialogChange} />
              <Field label="Zugang & Schlüssel" htmlFor="site-access-notes">
                <Textarea
                  value={siteDialog.draft.accessNotes ?? ''}
                  onChange={(e) =>
                    onSiteDialogChange({
                      ...siteDialog,
                      draft: {
                        ...siteDialog.draft,
                        accessNotes: e.target.value,
                      },
                    })
                  }
                  placeholder="z. B. Schlüssel bei Hausmeister, Parken im Hof"
                />
              </Field>
              <Field label="Ansprechpartner vor Ort" htmlFor="site-primary-contact">
                <SearchableSelect
                  options={contacts
                    // Archived contacts stay visible only while they are the
                    // current selection, so editing never silently drops them.
                    .filter((contact) => contact.isActive || contact.id === siteDialog.draft.primaryContactId)
                    .map((contact) => ({
                      value: contact.id,
                      label: `${contact.name}${contact.role ? ` (${contact.role})` : ''}${!contact.isActive ? ' · archiviert' : ''}`,
                    }))}
                  value={siteDialog.draft.primaryContactId ?? ''}
                  onChange={(value) =>
                    onSiteDialogChange({
                      ...siteDialog,
                      draft: {
                        ...siteDialog.draft,
                        primaryContactId: value || null,
                      },
                    })
                  }
                  placeholder="Nicht festgelegt"
                  searchPlaceholder="Ansprechpartner suchen…"
                  emptyMessage="Kein Ansprechpartner gefunden"
                  allowNone
                  noneLabel="Nicht festgelegt"
                />
              </Field>
              <Field label="Notizen" htmlFor="site-notes">
                <Textarea
                  value={siteDialog.draft.notes ?? ''}
                  onChange={(e) =>
                    onSiteDialogChange({
                      ...siteDialog,
                      draft: { ...siteDialog.draft, notes: e.target.value },
                    })
                  }
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={siteDialog.draft.isPrimary ?? false}
                  onCheckedChange={(checked) =>
                    onSiteDialogChange({
                      ...siteDialog,
                      draft: {
                        ...siteDialog.draft,
                        isPrimary: checked === true,
                      },
                    })
                  }
                />
                Als Hauptstandort festlegen
              </label>
              <ErrorText>{siteDialog.error}</ErrorText>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onSiteDialogChange(null)}>
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
