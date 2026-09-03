'use client';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { usePendingTask } from '@/hooks/use-server-action';
import { useRef, useState } from 'react';
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
import { Field } from '@/components/ui/field';
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
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const { run: runGuardTask, isPending } = usePendingTask();
  // The server check runs on the link click itself; the caller shows the
  // spinner beside that contact so the click visibly did something.
  const { run: runCheck, isBusy: isCheckingContact } = useBusyIds();

  function requestContact(input: Omit<PendingContact, 'warnings'>) {
    if (!isAllowedContactHref(input.channel, input.href)) {
      showBanner({ variant: 'error', message: 'Der Kontaktlink ist ungültig.' });
      return;
    }
    void runCheck(input.contactId, async () => {
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
      setReasonError(null);
      setPendingContact({ ...input, warnings: result.data.warnings });
    });
  }

  function continueWithException() {
    if (!pendingContact) return;
    if (!reason.trim()) {
      setReasonError('Bitte begründe die Ausnahme.');
      reasonRef.current?.focus();
      return;
    }
    void runGuardTask(async () => {
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
          <Field
            label="Begründung für die Ausnahme"
            htmlFor="contact-exception-reason"
            required
            error={reasonError}
          >
            <Textarea
              ref={reasonRef}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
              }}
              placeholder="Warum ist dieser Kontakt im konkreten Fall erforderlich?"
              maxLength={1000}
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingContact(null)} disabled={isPending}>Abbrechen</Button>
          <Button onClick={continueWithException} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Begründet fortfahren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { requestContact, isCheckingContact, dialog };
}
