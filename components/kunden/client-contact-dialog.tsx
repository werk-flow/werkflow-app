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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  SITE_CONTACT_ROLES,
  SITE_CONTACT_ROLE_LABELS,
  siteContactRoleSchema,
} from '@/lib/clients/site-roles';
import { formatSiteAddress, type ClientSite } from '@/lib/clients/types';

import type { ContactDialogState } from './client-relation-drafts';
import { ContactRoleField } from './contact-role-field';

interface ClientContactDialogProps {
  /** The customer's active Einsatzorte a contact can live at or open. */
  sites: ClientSite[];
  /** Null while the dialog is closed; the parent keeps the draft. */
  contactDialog: ContactDialogState | null;
  onContactDialogChange: (next: ContactDialogState | null) => void;
  onSave: () => void;
}

/** Phone, e-mail, notes and the primary flag of the open contact draft. */
function ClientContactDetailFields({
  contactDialog,
  onContactDialogChange,
}: {
  contactDialog: ContactDialogState;
  onContactDialogChange: (next: ContactDialogState | null) => void;
}) {
  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
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
        <Field label="E-Mail" htmlFor="contact-email" error={contactDialog.emailError}>
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
                emailError: null,
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
    </>
  );
}

/** The Einsatzort a Mieter or Zugangskontakt belongs to, and that role. */
function ClientContactSiteFields({
  sites,
  contactDialog,
  onContactDialogChange,
}: {
  sites: ClientSite[];
  contactDialog: ContactDialogState;
  onContactDialogChange: (next: ContactDialogState | null) => void;
}) {
  const { draft } = contactDialog;
  if (sites.length === 0 && !draft.siteId) return null;
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <Field label="Einsatzort" htmlFor="contact-site" description="Für Mieter und Zugangskontakte.">
        <SearchableSelect
          options={sites.map((site) => ({
            value: site.id,
            label: site.name,
            description: formatSiteAddress(site) || undefined,
          }))}
          value={draft.siteId ?? ''}
          onChange={(value) =>
            onContactDialogChange({
              ...contactDialog,
              draft: {
                ...draft,
                siteId: value || null,
                siteRole: value ? (draft.siteRole ?? 'mieter') : null,
              },
            })
          }
          placeholder="Keiner"
          searchPlaceholder="Einsatzort suchen…"
          emptyMessage="Kein Einsatzort gefunden"
          allowNone
          noneLabel="Keiner"
        />
      </Field>
      {draft.siteId && (
        <Field label="Rolle am Einsatzort" htmlFor="contact-site-role">
          <Select
            value={draft.siteRole ?? 'mieter'}
            onValueChange={(value) => {
              const siteRole = siteContactRoleSchema.safeParse(value);
              if (siteRole.success)
                onContactDialogChange({ ...contactDialog, draft: { ...draft, siteRole: siteRole.data } });
            }}
          >
            <SelectTrigger id="contact-site-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITE_CONTACT_ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {SITE_CONTACT_ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}

export function ClientContactDialog({
  sites,
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
            <ContactRoleField
              role={contactDialog.draft.role ?? ''}
              onRoleChange={(role) =>
                onContactDialogChange({ ...contactDialog, draft: { ...contactDialog.draft, role } })
              }
            />
            <ClientContactSiteFields
              sites={sites}
              contactDialog={contactDialog}
              onContactDialogChange={onContactDialogChange}
            />
            <ClientContactDetailFields
              contactDialog={contactDialog}
              onContactDialogChange={onContactDialogChange}
            />
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
