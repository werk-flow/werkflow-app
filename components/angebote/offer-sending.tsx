'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';

import { PdfFrame, usePdfRead } from '@/components/shared/pdf-frame';
import { useBanner } from '@/components/ui/banner';
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
import { SectionError } from '@/components/ui/section-error';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { sendOffer } from '@/lib/offers/send-actions';
import {
  OFFER_CHANNEL_LABELS,
  OFFER_CHANNELS,
  offerSendBlocker,
  type OfferChannel,
  type OfferDetail,
} from '@/lib/offers/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { useOfferUnsaved } from './offer-unsaved';

type SendableOffer = Pick<
  OfferDetail,
  'id' | 'offerNumber' | 'version' | 'contentVersion' | 'sections' | 'validUntil'
>;

const UNSAVED_MESSAGE =
  'Du hast Änderungen an den Positionen, die noch nicht gespeichert sind. Speichere sie zuerst, damit das Angebot sie enthält.';

const SEND_FAILED = 'Das Angebot konnte nicht festgehalten werden. Versuche es erneut.';
const SEND_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  save_failed: SEND_FAILED,
  render_failed:
    'Das PDF konnte nicht erstellt werden. Prüfe die Firmenangaben und das Briefpapier unter Einstellungen.',
  preview_outdated:
    'Seit der Vorschau hat sich etwas geändert, das im PDF steht. Prüfe die neue Vorschau und halte das Angebot dann fest.',
  offer_changed:
    'Jemand hat das Angebot gerade geändert. Lade die Seite neu und prüfe die Vorschau noch einmal.',
  offer_not_editable: 'Das Angebot ist kein Entwurf mehr.',
  offer_not_found: 'Das Angebot gibt es nicht mehr.',
  offer_empty: 'Das Angebot hat noch keine Position. Füge mindestens eine hinzu und speichere.',
  offer_expired:
    'Das Angebot ist nur bis vor heute gültig. Verlängere zuerst „Gültig bis“ unter „Bearbeiten“.',
};

const CHANNEL_FIELD_ID = 'offer-send-channel';

/** „Vorschau“ of a draft, for the page header; the preview is where the office records it as sent. */
export function OfferSendActions({ offer }: { offer: SendableOffer }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FileText className="size-4" />
        Vorschau
      </Button>
      {open && <OfferPreviewDialog offer={offer} onClose={() => setOpen(false)} />}
    </>
  );
}

/** „Gesendet per“: how the office says it sent the offer; nothing is preselected. */
function ChannelField({
  channel,
  error,
  onChange,
}: {
  channel: OfferChannel | null;
  error: string | undefined;
  onChange: (channel: OfferChannel | null) => void;
}) {
  return (
    <Field label="Gesendet per" htmlFor={CHANNEL_FIELD_ID} required error={error}>
      <Select
        value={channel ?? ''}
        onValueChange={(value) => onChange(OFFER_CHANNELS.find((option) => option === value) ?? null)}
      >
        <SelectTrigger id={CHANNEL_FIELD_ID} className="w-full">
          <SelectValue placeholder="Auswählen" />
        </SelectTrigger>
        <SelectContent>
          {OFFER_CHANNELS.map((option) => (
            <SelectItem key={option} value={option}>
              {OFFER_CHANNEL_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

type PdfPreview = ReturnType<typeof usePdfRead>;

/**
 * „Als gesendet festhalten“ of the PDF `preview` shows: the channel is
 * required, and the send names the preview's hash, so the server files
 * exactly that PDF or refuses with `preview_outdated`, which renders it anew.
 */
function useOfferSend(offer: SendableOffer, preview: PdfPreview, onSent: () => void) {
  const { showBanner } = useBanner();
  const unsaved = useOfferUnsaved();
  // One key per opening: a press repeated after a lost answer gets the first revision.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [channel, setChannel] = useState<OfferChannel | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  // The action's answer carries the page with the sent offer; the dialog stays pending until it is on screen.
  const settle = useSettleOnChange(offer.version);
  const channelError = channel ? undefined : 'Wähle, wie du das Angebot gesendet hast.';
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField({ [CHANNEL_FIELD_ID]: channelError }) || !channel) return;
    // Sending freezes the draft: what the editor holds unsaved would be lost.
    if (unsaved) {
      setError(UNSAVED_MESSAGE);
      return;
    }
    const previewHash = preview.data?.contentHash;
    if (!previewHash) {
      setError('Halte das Angebot fest, sobald die Vorschau zu sehen ist.');
      return;
    }
    void run(async () => {
      setError(null);
      const since = settle.markChange();
      const result = await sendOffer({
        offerId: offer.id,
        expectedVersion: offer.version,
        expectedContentVersion: offer.contentVersion,
        channel,
        previewHash,
        attemptKey,
      }).catch(() => null);
      if (!result?.success) {
        setError(result ? describeFailure(result.error, SEND_FAILURE_MESSAGES, SEND_FAILED) : SEND_FAILED);
        if (result?.error === 'preview_outdated') preview.reload();
        return;
      }
      await settle(since);
      showBanner({
        variant: 'success',
        message: `${offer.offerNumber} ist als gesendet festgehalten (Revision ${result.revision}). Das PDF liegt bei den Revisionen.`,
      });
      onSent();
    });
  };
  return {
    channel,
    setChannel,
    channelError: attempted ? channelError : undefined,
    error,
    pending: isPending,
    submit,
  };
}

/**
 * The saved draft as the PDF its customer gets, rendered by the server, and
 * „Als gesendet festhalten“ below it: the office names how it sent the offer,
 * and the server files exactly the PDF shown here, or refuses when its
 * rendering changed since. WerkFlow sends nothing itself.
 */
function OfferPreviewDialog({ offer, onClose }: { offer: SendableOffer; onClose: () => void }) {
  const preview = usePdfRead({
    path: `/api/angebote/vorschau?angebot=${offer.id}`,
    deps: [offer.version, offer.contentVersion],
    failureMessage: 'Die Vorschau konnte nicht erstellt werden.',
  });
  const send = useOfferSend(offer, preview, onClose);
  const unsaved = useOfferUnsaved();
  const blocker = offerSendBlocker(offer, getBusinessTodayIso());
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={send.pending}
    >
      <DialogContent size="4xl">
        <form onSubmit={send.submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Vorschau {offer.offerNumber}</DialogTitle>
            <DialogDescription>
              So bekommt dein Kunde das Angebot, wenn du es heute als gesendet festhältst. Die Vorschau zeigt
              den gespeicherten Stand. WerkFlow verschickt nichts: Du hältst fest, wie du es selbst gesendet
              hast, und genau dieses PDF wird abgelegt und lässt sich danach nicht mehr ändern.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {preview.failure ? (
              <SectionError failure={preview.failure} />
            ) : (
              <PdfFrame
                url={preview.data?.url}
                title={`Vorschau ${offer.offerNumber}`}
                loadingLabel="Vorschau wird erstellt."
              />
            )}
            {blocker ? (
              // The server would refuse this draft: the preview names why instead of offering the send.
              <p className="text-sm text-muted-foreground">{SEND_FAILURE_MESSAGES[blocker]}</p>
            ) : (
              <>
                {unsaved && <p className="text-sm text-muted-foreground">{UNSAVED_MESSAGE}</p>}
                <ChannelField channel={send.channel} error={send.channelError} onChange={send.setChannel} />
                <ErrorText>{send.error}</ErrorText>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {preview.data && (
              <Button variant="outline" asChild>
                <a href={preview.data.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  In neuem Tab öffnen
                </a>
              </Button>
            )}
            {!blocker && (
              <Button pending={send.pending} type="submit" disabled={send.pending}>
                Als gesendet festhalten
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
