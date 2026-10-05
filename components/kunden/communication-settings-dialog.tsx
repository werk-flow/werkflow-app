'use client';

import { Loader2 } from 'lucide-react';
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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { ClientContact } from '@/lib/clients/types';
import type { CommunicationChannel, CommunicationSettingsInput } from '@/lib/customer-relationships/types';
import { CHANNEL_LABELS } from './communication-preference-labels';

interface CommunicationSettingsDialogProps {
  open: boolean;
  contacts: ClientContact[];
  settingsDraft: CommunicationSettingsInput;
  settingsError: string | null;
  isPending: boolean;
  onDraftChange: (draft: CommunicationSettingsInput) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}

export function CommunicationSettingsDialog({
  open,
  contacts,
  settingsDraft,
  settingsError,
  isPending,
  onDraftChange,
  onOpenChange,
  onSave,
}: CommunicationSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allgemeine Kontaktvorgaben</DialogTitle>
          <DialogDescription>
            Halte praktische Hinweise und ihre Quelle fest. Leere Felder bleiben unkonfiguriert.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4 py-1">
            <Field label="Bevorzugter Ansprechpartner" htmlFor="preferred-contact">
              <SearchableSelect
                options={contacts
                  // The selected archived contact stays visible so editing
                  // never shows a raw id or silently drops the selection.
                  .filter((contact) => contact.isActive || contact.id === settingsDraft.preferredContactId)
                  .map((contact) => ({
                    value: contact.id,
                    label: `${contact.name}${contact.isActive ? '' : ' · archiviert'}`,
                  }))}
                value={settingsDraft.preferredContactId ?? ''}
                onChange={(value) =>
                  onDraftChange({ ...settingsDraft, preferredContactId: value || undefined })
                }
                placeholder="Nicht festgelegt"
                searchPlaceholder="Ansprechpartner suchen…"
                emptyMessage="Kein Ansprechpartner gefunden"
                allowNone
                noneLabel="Nicht festgelegt"
              />
            </Field>
            <Field label="Bevorzugter Kanal" htmlFor="preferred-channel">
              <Select
                value={settingsDraft.preferredChannel ?? '__none__'}
                onValueChange={(value) =>
                  onDraftChange({
                    ...settingsDraft,
                    preferredChannel: value === '__none__' ? undefined : (value as CommunicationChannel),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nicht festgelegt</SelectItem>
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Nicht-kontaktieren-Hinweis" htmlFor="dnc-note">
              <Textarea
                value={settingsDraft.doNotContactInstruction ?? ''}
                onChange={(event) =>
                  onDraftChange({ ...settingsDraft, doNotContactInstruction: event.target.value })
                }
              />
            </Field>
            <Field label="Geeignete Kontaktzeit" htmlFor="contact-time">
              <Input
                value={settingsDraft.contactTimeNote ?? ''}
                onChange={(event) => onDraftChange({ ...settingsDraft, contactTimeNote: event.target.value })}
              />
            </Field>
            <Field label="Sprache" htmlFor="language-note">
              <Input
                value={settingsDraft.languageNote ?? ''}
                onChange={(event) => onDraftChange({ ...settingsDraft, languageNote: event.target.value })}
              />
            </Field>
            <Field label="Barrierefreiheit / Unterstützungsbedarf" htmlFor="accessibility-note">
              <Textarea
                value={settingsDraft.accessibilityNote ?? ''}
                onChange={(event) =>
                  onDraftChange({ ...settingsDraft, accessibilityNote: event.target.value })
                }
              />
            </Field>
            <Field label="Quelle der Angaben" htmlFor="settings-source">
              <Input
                value={settingsDraft.sourceNote ?? ''}
                onChange={(event) => onDraftChange({ ...settingsDraft, sourceNote: event.target.value })}
                placeholder="z. B. Kundengespräch am 10.08.2026"
              />
            </Field>
            <ErrorText>{settingsError}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
