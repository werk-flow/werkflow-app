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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { ClientContact } from '@/lib/clients/types';
import type {
  CommunicationChannel,
  CommunicationPreferenceInput,
  CommunicationPreferenceState,
  CommunicationPurpose,
} from '@/lib/customer-relationships/types';
import { CHANNEL_LABELS, PURPOSE_LABELS, STATE_LABELS } from './communication-preference-labels';

interface CommunicationPreferenceDialogProps {
  open: boolean;
  contacts: ClientContact[];
  preferenceDraft: CommunicationPreferenceInput;
  preferenceError: string | null;
  isPending: boolean;
  onDraftChange: (draft: CommunicationPreferenceInput) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}

export function CommunicationPreferenceDialog({
  open,
  contacts,
  preferenceDraft,
  preferenceError,
  isPending,
  onDraftChange,
  onOpenChange,
  onSave,
}: CommunicationPreferenceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kontaktpräferenz festhalten</DialogTitle>
          <DialogDescription>
            Die Vorgabe gilt für den gewählten Zweck und Kanal. Ansprechpartner-spezifische Angaben
            überschreiben den Kundenstandard.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
          noValidate
          className="space-y-4"
        >
          <Field label="Gilt für" htmlFor="preference-contact">
            <SearchableSelect
              options={contacts
                .filter((contact) => contact.isActive || contact.id === preferenceDraft.contactId)
                .map((contact) => ({
                  value: contact.id,
                  label: `${contact.name}${contact.isActive ? '' : ' · archiviert'}`,
                }))}
              value={preferenceDraft.contactId ?? ''}
              onChange={(value) => onDraftChange({ ...preferenceDraft, contactId: value || undefined })}
              placeholder="Kunde (Standard)"
              searchPlaceholder="Ansprechpartner suchen…"
              emptyMessage="Kein Ansprechpartner gefunden"
              allowNone
              noneLabel="Kunde (Standard)"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kanal" htmlFor="preference-channel">
              <Select
                value={preferenceDraft.channel}
                onValueChange={(value) =>
                  onDraftChange({ ...preferenceDraft, channel: value as CommunicationChannel })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status" htmlFor="preference-state">
              <Select
                value={preferenceDraft.state}
                onValueChange={(value) =>
                  onDraftChange({ ...preferenceDraft, state: value as CommunicationPreferenceState })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Zweck" htmlFor="preference-purpose">
            <Select
              value={preferenceDraft.purpose}
              onValueChange={(value) =>
                onDraftChange({ ...preferenceDraft, purpose: value as CommunicationPurpose })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Quelle der Angabe" htmlFor="preference-source">
            <Input
              value={preferenceDraft.sourceNote ?? ''}
              onChange={(event) => onDraftChange({ ...preferenceDraft, sourceNote: event.target.value })}
              placeholder="z. B. ausdrückliche Angabe im Telefonat"
            />
          </Field>
          <ErrorText>{preferenceError}</ErrorText>
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
