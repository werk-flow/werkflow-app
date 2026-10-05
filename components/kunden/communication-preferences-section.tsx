'use client';

import { useState } from 'react';
import { CircleAlert, MessageSquareWarning, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { useBanner } from '@/components/ui/banner';
import {
  saveCustomerCommunicationPreference,
  saveCustomerCommunicationSettings,
} from '@/lib/customer-relationships/actions';
import type {
  CommunicationPreferenceInput,
  CommunicationSettingsInput,
  CustomerRelationshipBundle,
} from '@/lib/customer-relationships/types';
import type { ClientContact } from '@/lib/clients/types';
import { CommunicationPreferenceDialog } from './communication-preference-dialog';
import { CHANNEL_LABELS, PURPOSE_LABELS, STATE_LABELS } from './communication-preference-labels';
import { CommunicationSettingsDialog } from './communication-settings-dialog';

function communicationTargetLabel(contactId: string | null, contacts: ClientContact[]): string {
  if (!contactId) return 'Kunde (Standard)';
  return contacts.find((contact) => contact.id === contactId)?.name ?? 'Archivierter Ansprechpartner';
}

interface CommunicationPreferencesSummaryProps {
  bundle: CustomerRelationshipBundle;
  contacts: ClientContact[];
}

/** The stored contact rules, or the hint that nothing is configured yet. */
function CommunicationPreferencesSummary({ bundle, contacts }: CommunicationPreferencesSummaryProps) {
  const settings = bundle.communicationSettings;
  const preferredContactName = settings?.preferredContactId
    ? (contacts.find((contact) => contact.id === settings.preferredContactId)?.name ??
      'Archivierter Ansprechpartner')
    : null;

  return !settings && bundle.communicationPreferences.length === 0 ? (
    <div className="rounded-md border border-dashed px-3 py-3">
      <p className="text-sm font-medium">Noch nicht konfiguriert</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Unbekannt bedeutet weder erlaubt noch verboten. Vor einem Kontakt sollte die Situation geprüft werden.
      </p>
    </div>
  ) : (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {settings?.doNotContactInstruction && (
        <div className="flex gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Nicht kontaktieren ohne Prüfung</p>
            <p className="text-muted-foreground">{settings.doNotContactInstruction}</p>
          </div>
        </div>
      )}
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Bevorzugter Kontakt</dt>
          <dd>{preferredContactName ?? 'Nicht festgelegt'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Bevorzugter Kanal</dt>
          <dd>
            {settings?.preferredChannel ? CHANNEL_LABELS[settings.preferredChannel] : 'Nicht festgelegt'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Kontaktzeit</dt>
          <dd>{settings?.contactTimeNote || 'Nicht festgelegt'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Sprache / Barrierefreiheit</dt>
          <dd>
            {[settings?.languageNote, settings?.accessibilityNote].filter(Boolean).join(' · ') ||
              'Nicht festgelegt'}
          </dd>
        </div>
      </dl>
      {bundle.communicationPreferences.length > 0 && (
        <div className="divide-y border-t">
          {bundle.communicationPreferences.map((preference) => (
            <div
              key={preference.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div>
                <p>
                  {communicationTargetLabel(preference.contactId, contacts)} ·{' '}
                  {CHANNEL_LABELS[preference.channel]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {PURPOSE_LABELS[preference.purpose]}
                  {preference.sourceNote ? ` · Quelle: ${preference.sourceNote}` : ''}
                </p>
              </div>
              <Badge variant={preference.state === 'disallowed' ? 'destructive' : 'outline'}>
                {STATE_LABELS[preference.state]}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommunicationPreferencesSection({
  clientId,
  contacts,
  bundle,
  settingsOpen,
  preferenceOpen,
  isPending,
  isSettling,
  onSettingsOpenChange,
  onPreferenceOpenChange,
  onSaved,
  runTask,
}: {
  clientId: string;
  contacts: ClientContact[];
  bundle: CustomerRelationshipBundle;
  settingsOpen: boolean;
  preferenceOpen: boolean;
  isPending: boolean;
  /** A save was confirmed and the refreshed bundle has not landed yet. */
  isSettling: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  onPreferenceOpenChange: (open: boolean) => void;
  onSaved: () => void;
  runTask: (task: () => Promise<void>) => Promise<void | null>;
}) {
  const settings = bundle.communicationSettings;
  const { showBanner } = useBanner();
  const [settingsDraft, setSettingsDraft] = useState<CommunicationSettingsInput>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<CommunicationPreferenceInput>({
    channel: 'phone',
    purpose: 'appointment_service',
    state: 'unknown',
  });

  function handlePreferenceOpenChange(open: boolean) {
    if (!open) {
      setPreferenceDraft({
        channel: 'phone',
        purpose: 'appointment_service',
        state: 'unknown',
      });
    }
    setPreferenceError(null);
    onPreferenceOpenChange(open);
  }

  function openSettings() {
    setSettingsDraft({
      preferredContactId: settings?.preferredContactId ?? undefined,
      preferredChannel: settings?.preferredChannel ?? undefined,
      doNotContactInstruction: settings?.doNotContactInstruction ?? '',
      contactTimeNote: settings?.contactTimeNote ?? '',
      languageNote: settings?.languageNote ?? '',
      accessibilityNote: settings?.accessibilityNote ?? '',
      sourceNote: settings?.sourceNote ?? '',
    });
    onSettingsOpenChange(true);
  }

  function saveSettings() {
    setSettingsError(null);
    void runTask(async () => {
      const result = await saveCustomerCommunicationSettings(clientId, settingsDraft);
      if (!result.success) {
        setSettingsError('Die allgemeinen Kontaktvorgaben konnten nicht gespeichert werden.');
        return;
      }
      onSettingsOpenChange(false);
      showBanner({ variant: 'success', message: 'Kontaktvorgaben gespeichert.' });
      onSaved();
    });
  }

  function savePreference() {
    setPreferenceError(null);
    void runTask(async () => {
      const result = await saveCustomerCommunicationPreference(clientId, preferenceDraft);
      if (!result.success) {
        setPreferenceError('Die Kontaktpräferenz konnte nicht gespeichert werden.');
        return;
      }
      handlePreferenceOpenChange(false);
      showBanner({ variant: 'success', message: 'Kontaktpräferenz gespeichert.' });
      onSaved();
    });
  }

  return (
    <section id="kontaktvorgaben" className="scroll-mt-4 space-y-3" aria-labelledby="communication-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="communication-heading" className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareWarning className="size-4 text-muted-foreground" />
            Kontaktvorgaben
            <InlinePending active={isSettling} />
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Hinweise für zukünftige Kontakte. Es werden keine Nachrichten versendet.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openSettings}>
            Allgemein bearbeiten
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePreferenceOpenChange(true)}>
            <Plus className="size-3.5" /> Präferenz
          </Button>
        </div>
      </div>

      <CommunicationPreferencesSummary bundle={bundle} contacts={contacts} />
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        Diese Angaben sind betriebliche Kontaktvorgaben und keine Aussage zur rechtlichen Zulässigkeit.
      </p>

      <CommunicationSettingsDialog
        open={settingsOpen}
        contacts={contacts}
        settingsDraft={settingsDraft}
        settingsError={settingsError}
        isPending={isPending}
        onDraftChange={setSettingsDraft}
        onOpenChange={(open) => {
          if (!open) setSettingsError(null);
          onSettingsOpenChange(open);
        }}
        onSave={saveSettings}
      />

      <CommunicationPreferenceDialog
        open={preferenceOpen}
        contacts={contacts}
        preferenceDraft={preferenceDraft}
        preferenceError={preferenceError}
        isPending={isPending}
        onDraftChange={setPreferenceDraft}
        onOpenChange={handlePreferenceOpenChange}
        onSave={savePreference}
      />
    </section>
  );
}
