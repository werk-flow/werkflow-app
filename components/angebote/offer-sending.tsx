'use client';

import { ExternalLink, FileText, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import { describeFailure } from '@/lib/action-messages';
import { sendOffer } from '@/lib/offers/send-actions';
import {
  OFFER_CHANNEL_LABELS,
  OFFER_CHANNELS,
  type OfferChannel,
  type OfferDetail,
} from '@/lib/offers/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

type SendableOffer = Pick<OfferDetail, 'id' | 'offerNumber' | 'version' | 'contentVersion'>;

const SEND_FAILED = 'Das Angebot konnte nicht festgehalten werden. Versuche es erneut.';
const SEND_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  save_failed: SEND_FAILED,
  render_failed:
    'Das PDF konnte nicht erstellt werden. Prüfe die Firmenangaben und das Briefpapier unter Einstellungen.',
  offer_changed:
    'Jemand hat das Angebot gerade geändert. Lade die Seite neu und prüfe die Vorschau noch einmal.',
  offer_not_editable: 'Das Angebot ist kein Entwurf mehr.',
  offer_not_found: 'Das Angebot gibt es nicht mehr.',
  offer_empty: 'Das Angebot hat noch keine Position. Füge mindestens eine hinzu und speichere.',
  offer_expired:
    'Das Angebot ist nur bis vor heute gültig. Verlängere zuerst „Gültig bis“ unter „Bearbeiten“.',
};

const CHANNEL_FIELD_ID = 'offer-send-channel';

/** „Vorschau“ and „Als gesendet festhalten“ of a draft, for the page header. */
export function OfferSendActions({ offer }: { offer: SendableOffer }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
        <FileText className="size-4" />
        Vorschau
      </Button>
      <Button type="button" variant="outline" onClick={() => setSendOpen(true)}>
        <Send className="size-4" />
        Als gesendet festhalten
      </Button>
      {previewOpen && <OfferPreviewDialog offer={offer} onClose={() => setPreviewOpen(false)} />}
      {sendOpen && <SendOfferDialog offer={offer} onClose={() => setSendOpen(false)} />}
    </>
  );
}

/** The saved draft as the PDF „Als gesendet festhalten“ stores, rendered by the server, shown inline. */
function OfferPreviewDialog({ offer, onClose }: { offer: SendableOffer; onClose: () => void }) {
  const preview = usePdfRead({
    path: `/api/angebote/vorschau?angebot=${offer.id}`,
    deps: [offer.version, offer.contentVersion],
    failureMessage: 'Die Vorschau konnte nicht erstellt werden.',
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="4xl">
        <DialogHeader>
          <DialogTitle>Vorschau {offer.offerNumber}</DialogTitle>
          <DialogDescription>
            So bekommt dein Kunde das Angebot, wenn du es heute als gesendet festhältst. Die Vorschau zeigt
            den gespeicherten Stand.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {preview.failure ? (
            <SectionError failure={preview.failure} />
          ) : (
            <PdfFrame
              url={preview.data?.url}
              title={`Vorschau ${offer.offerNumber}`}
              loadingLabel="Vorschau wird erstellt."
            />
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/**
 * „Als gesendet festhalten“: the office names how it sent the offer, and the
 * server freezes the saved draft as its next revision with the PDF the
 * preview shows. WerkFlow sends nothing itself.
 */
function SendOfferDialog({ offer, onClose }: { offer: SendableOffer; onClose: () => void }) {
  const router = useRouter();
  const { showBanner } = useBanner();
  // One key per opening: a press repeated after a lost answer gets the first revision.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [channel, setChannel] = useState<OfferChannel | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending: pending } = usePendingTask();
  const channelError = channel ? undefined : 'Wähle, wie du das Angebot gesendet hast.';
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField({ [CHANNEL_FIELD_ID]: channelError }) || !channel) return;
    void run(async () => {
      setError(null);
      const result = await sendOffer({
        offerId: offer.id,
        expectedVersion: offer.version,
        expectedContentVersion: offer.contentVersion,
        channel,
        attemptKey,
      }).catch(() => null);
      if (!result?.success) {
        setError(result ? describeFailure(result.error, SEND_FAILURE_MESSAGES, SEND_FAILED) : SEND_FAILED);
        return;
      }
      showBanner({
        variant: 'success',
        message: `${offer.offerNumber} ist als gesendet festgehalten (Revision ${result.revision}). Das PDF liegt bei den Revisionen.`,
      });
      router.refresh();
      onClose();
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={pending}
    >
      <DialogContent size="md">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Angebot als gesendet festhalten?</DialogTitle>
            <DialogDescription>
              WerkFlow verschickt nichts. Du hältst fest, dass du das Angebot selbst gesendet hast. Der
              gespeicherte Stand wird mit dem heutigen Datum als PDF abgelegt, wie ihn die Vorschau zeigt, und
              lässt sich danach nicht mehr ändern.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2 py-1">
            <ChannelField
              channel={channel}
              error={attempted ? channelError : undefined}
              onChange={setChannel}
            />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button pending={pending} type="submit" disabled={pending}>
              Als gesendet festhalten
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
