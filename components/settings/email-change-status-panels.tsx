'use client';

import { CheckCircle2, Loader2, Mail } from 'lucide-react';

import { type CompletionState } from '@/components/settings/email-change-wizard-state';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';

export function EmailChangeCompletionPendingNotice({ wizardState }: { wizardState: EmailChangeWizardState }) {
  return (
    <div className="space-y-3" role="status">
      <p className="font-medium">Bestätigung der E-Mail-Änderung steht aus</p>
      <p className="text-sm text-muted-foreground">
        Die Änderung auf {wizardState.newEmail} wurde angefragt. Die Bestätigung fehlt noch. Bis der Vorgang
        geklärt ist, kannst du keine weitere E-Mail-Änderung starten. Bleibt der Status unverändert, wende
        dich bitte an den WerkFlow-Support.
      </p>
      <div className="flex items-center gap-2 text-sm">
        <span>Status prüfen</span>
        <RefreshButton label="Status der E-Mail-Änderung prüfen" />
      </div>
    </div>
  );
}

export function EmailChangeCompletedNotice({
  completionState,
  onDismiss,
}: {
  completionState: CompletionState;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border bg-primary/5 p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2 text-primary">
          <CheckCircle2 className="size-5" />
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <p className="font-medium text-foreground">E-Mail-Adresse erfolgreich aktualisiert</p>
            <p className="text-sm text-muted-foreground">
              Dein Konto verwendet jetzt die neue Adresse zum Login.
            </p>
          </div>
          <div className="rounded-lg border bg-background p-3 text-sm">
            <p className="text-muted-foreground">
              Bisherige Adresse:{' '}
              <span className="font-medium text-foreground">{completionState.previousEmail}</span>
            </p>
            <p className="mt-1 text-muted-foreground">
              Neue Adresse: <span className="font-medium text-foreground">{completionState.newEmail}</span>
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onDismiss}>
            Fertig
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CurrentEmailPanel({
  currentEmail,
  step,
  isStarting,
  onStart,
}: {
  currentEmail: string;
  step: EmailChangeWizardState['step'];
  isStarting: boolean;
  onStart: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium text-foreground">Aktuelle E-Mail-Adresse</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-full bg-primary/10 p-2 text-primary">
            <Mail className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground">{currentEmail || '—'}</p>
            <p className="text-sm text-muted-foreground">
              Diese Adresse ist aktuell mit deinem Konto verknüpft.
            </p>
          </div>
        </div>
        {step === 'idle' ? (
          <Button type="button" onClick={onStart} disabled={isStarting || !currentEmail}>
            {isStarting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Startet…
              </>
            ) : (
              'E-Mail-Adresse ändern'
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
