'use client';

import { useBanner } from '@/components/ui/banner';
import { useState, useTransition } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  evaluateCustomerCommunicationGuidance,
  recordCustomerCommunicationException,
} from '@/lib/customer-relationships/actions';
import type {
  CommunicationChannel,
  CommunicationWarningCode,
} from '@/lib/customer-relationships/types';

const WARNING_TEXT: Record<CommunicationWarningCode, string> = {
  do_not_contact: 'Für diesen Kunden ist ein Nicht-kontaktieren-Hinweis hinterlegt.',
  wrong_contact: 'Ein anderer Ansprechpartner ist als bevorzugter Kontakt hinterlegt.',
  disallowed_channel: 'Dieser Kontaktweg ist für Termin- und Servicekontakte als nicht erlaubt hinterlegt.',
};

type PendingContact = {
  contactId: string;
  contactName: string;
  channel: Extract<CommunicationChannel, 'phone' | 'email'>;
  href: string;
  warnings: CommunicationWarningCode[];
};

function isAllowedContactHref(
  channel: PendingContact['channel'],
  href: string
): boolean {
  try {
    const url = new URL(href);
    return url.protocol === (channel === 'phone' ? 'tel:' : 'mailto:');
  } catch {
    return false;
  }
}

export function useCommunicationContactGuard({
  clientId,
}: {
  clientId: string;
}) {
  const { showBanner } = useBanner();
  const [pendingContact, setPendingContact] = useState<PendingContact | null>(null);
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();

  function requestContact(input: Omit<PendingContact, 'warnings'>) {
    if (!isAllowedContactHref(input.channel, input.href)) {
      showBanner({ variant: 'error', message: 'Der Kontaktlink ist ungültig.' });
      return;
    }
    startTransition(async () => {
      // Re-evaluate on the server at contact time so a stale tab cannot skip a
      // preference or do-not-contact warning that was just added elsewhere.
      const result = await evaluateCustomerCommunicationGuidance(clientId, {
        contactId: input.contactId,
        channel: input.channel,
        purpose: 'appointment_service',
      });
      if (!result.success) {
        showBanner({ variant: 'error', message: 'Die Kontaktvorgaben konnten nicht geprüft werden.' });
        return;
      }
      if (result.data.warnings.length === 0) {
        window.location.href = input.href;
        return;
      }
      setReason('');
      setPendingContact({ ...input, warnings: result.data.warnings });
    });
  }

  function continueWithException() {
    if (!pendingContact || !reason.trim()) return;
    startTransition(async () => {
      const result = await recordCustomerCommunicationException(clientId, {
        contactId: pendingContact.contactId,
        channel: pendingContact.channel,
        purpose: 'appointment_service',
        reason,
      });
      if (!result.success) {
        showBanner({ variant: 'error', message: 'Die begründete Ausnahme konnte nicht dokumentiert werden.' });
        return;
      }
      const href = pendingContact.href;
      if (!isAllowedContactHref(pendingContact.channel, href)) {
        showBanner({ variant: 'error', message: 'Der Kontaktlink ist ungültig.' });
        return;
      }
      setPendingContact(null);
      window.location.href = href;
    });
  }

  const dialog = (
    <Dialog
      open={pendingContact !== null}
      onOpenChange={(open) => !open && !isPending && setPendingContact(null)}
    >
      <DialogContent
        onEscapeKeyDown={(event) => isPending && event.preventDefault()}
        onPointerDownOutside={(event) => isPending && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Kontaktvorgabe prüfen</DialogTitle>
          <DialogDescription>
            Prüfe den Kontakt zu {pendingContact?.contactName}, bevor du fortfährst. WerkFlow entscheidet nicht über die rechtliche Zulässigkeit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ul className="space-y-2">
            {pendingContact?.warnings.map((warning) => (
              <li key={warning} className="flex gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {WARNING_TEXT[warning]}
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="contact-exception-reason">Begründung für die Ausnahme</Label>
            <Textarea
              id="contact-exception-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Warum ist dieser Kontakt im konkreten Fall erforderlich?"
              maxLength={1000}
              rows={3}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingContact(null)} disabled={isPending}>Abbrechen</Button>
          <Button onClick={continueWithException} disabled={isPending || !reason.trim()}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Begründet fortfahren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { requestContact, dialog };
}
