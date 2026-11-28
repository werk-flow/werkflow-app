'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useHydrated } from '@/hooks/use-hydrated';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { formatAlternativeMark, formatEuroCents } from '@/lib/document-rendering/format';
import {
  acceptedScopeTotals,
  offerOptions,
  type OfferOption,
  type RevisionContent,
} from '@/lib/offers/accepted-scope';
import { acceptOffer } from '@/lib/offers/decision-actions';
import {
  ACCEPTANCE_CHANNEL_LABELS,
  ACCEPTANCE_CHANNELS,
  type AcceptanceChannel,
  type OfferDetail,
  type OfferRevision,
} from '@/lib/offers/types';
import { ownWrites } from '@/lib/realtime/own-writes';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate, toLocalDateString } from '@/lib/utils';
import { DECISION_FAILED, DECISION_FAILURE_MESSAGES } from './offer-decision-reason';

const FIELD = {
  name: 'offer-accept-name',
  date: 'offer-accept-date',
  channel: 'offer-accept-channel',
  note: 'offer-accept-note',
} as const;

type AcceptableOffer = Pick<OfferDetail, 'id' | 'offerNumber' | 'version' | 'status'>;

/**
 * „Annahme erfassen“ of the newest sent revision: who accepted it, on which
 * day and how, with the chosen Bedarfs- and Alternativpositionen. The office
 * states what it observed; WerkFlow checks no signature.
 */
export function AcceptOfferButton(props: {
  offer: AcceptableOffer;
  revision: Pick<OfferRevision, 'revision' | 'sentOn' | 'validUntil'>;
  content: RevisionContent;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" disabled={!hydrated} onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-4" />
        Annahme erfassen
      </Button>
      {open && <AcceptOfferDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function optionLabel(option: OfferOption): string {
  const what =
    option.kind === 'bedarf'
      ? 'Bedarfsposition'
      : formatAlternativeMark({ number: option.replaces.number, differenceCents: option.differenceCents });
  return `${option.number} ${option.name} (${what}, ${formatEuroCents(option.amountCents)})`;
}

/** The choice after `option` is ticked or cleared: one Alternativposition per replaced Position. */
function toggled(
  options: readonly OfferOption[],
  chosen: readonly string[],
  option: OfferOption,
  on: boolean,
) {
  if (!on) return chosen.filter((number) => number !== option.number);
  const replaced = option.kind === 'alternative' ? option.replaces.number : null;
  const others = chosen.filter((number) => {
    const other = options.find((candidate) => candidate.number === number);
    return !(replaced && other?.kind === 'alternative' && other.replaces.number === replaced);
  });
  return [...others, option.number];
}

type Revision = Pick<OfferRevision, 'revision' | 'sentOn' | 'validUntil'>;
type AcceptanceForm = {
  name: string;
  acceptedOn: string;
  channel: AcceptanceChannel | null;
  chosen: string[];
  note: string;
};
type FieldErrors = {
  [Id in typeof FIELD.name | typeof FIELD.date | typeof FIELD.channel]?: string | undefined;
};

/** The form's values, its field errors once submitted, and the submit that records the Annahme. */
function useAcceptOffer(offer: AcceptableOffer, revision: Revision, onClose: () => void) {
  const { showBanner } = useBanner();
  const today = getBusinessTodayIso();
  // One key per opening: a press repeated after a lost answer gets the first Annahme.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<AcceptanceForm>({
    name: '',
    acceptedOn: today,
    channel: null,
    chosen: [],
    note: '',
  });
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  // The action's answer carries the page with the Annahme; the dialog stays pending until it is on screen.
  const settle = useSettleOnChange(offer.version);
  const { acceptedOn, channel } = form;
  const errors: FieldErrors = {
    [FIELD.name]: form.name.trim() ? undefined : 'Trag ein, wer angenommen hat.',
    [FIELD.date]: !acceptedOn
      ? 'Wähle den Tag der Annahme.'
      : acceptedOn > today
        ? 'Die Annahme kann nicht in der Zukunft liegen.'
        : acceptedOn < revision.sentOn
          ? `Revision ${revision.revision} wurde erst am ${formatGermanDate(revision.sentOn)} gesendet.`
          : undefined,
    [FIELD.channel]: channel ? undefined : 'Wähle, wie angenommen wurde.',
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(errors) || !channel) return;
    void run(async () => {
      setError(null);
      const since = settle.markChange();
      const input = {
        offerId: offer.id,
        expectedVersion: offer.version,
        attemptKey,
        revision: revision.revision,
        acceptedByName: form.name,
        acceptedOn,
        channel,
        note: form.note,
        chosenOptions: form.chosen,
      };
      // Recorded, so this tab skips the Realtime echo of its own write (lib/realtime/own-writes.ts).
      const result = await ownWrites.track(acceptOffer(input)).catch(() => null);
      if (!result?.success) {
        setError(
          result
            ? describeFailure(result.error, DECISION_FAILURE_MESSAGES, DECISION_FAILED)
            : DECISION_FAILED,
        );
        return;
      }
      await settle(since);
      showBanner({ variant: 'success', message: `Die Annahme von ${offer.offerNumber} ist erfasst.` });
      onClose();
    });
  };
  const update = (patch: Partial<AcceptanceForm>) => setForm((current) => ({ ...current, ...patch }));
  return { form, update, errors: attempted ? errors : {}, error, isPending, submit };
}

function AcceptOfferDialog({
  offer,
  revision,
  content,
  onClose,
}: {
  offer: AcceptableOffer;
  revision: Revision;
  content: RevisionContent;
  onClose: () => void;
}) {
  const { form, update, errors, error, isPending, submit } = useAcceptOffer(offer, revision, onClose);
  const options = offerOptions(content);
  const totals = acceptedScopeTotals(content, form.chosen);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      pending={isPending}
    >
      <DialogContent size="lg">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Annahme von Revision {revision.revision} erfassen</DialogTitle>
            <DialogDescription>
              Halte fest, wer {offer.offerNumber} wann und wie angenommen hat. Der angenommene Umfang wird
              danach nicht mehr geändert. WerkFlow prüft keine Unterschrift.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {offer.status === 'entwurf' && (
              <p className="text-sm text-muted-foreground">
                {`Revision ${revision.revision + 1} ist noch ein Entwurf. Mit der Annahme von Revision ${revision.revision} wird er geschlossen, und seine Änderungen werden nicht gesendet.`}
              </p>
            )}
            <AcceptanceFacts form={form} update={update} errors={errors} />
            {form.acceptedOn > revision.validUntil && (
              <p className="text-sm text-muted-foreground">
                {`Revision ${revision.revision} war nur bis ${formatGermanDate(revision.validUntil)} gültig. Die Annahme wird trotzdem erfasst und als verspätet vermerkt.`}
              </p>
            )}
            {options.length > 0 && (
              <AcceptanceOptions
                options={options}
                chosen={form.chosen}
                onChange={(chosen) => update({ chosen })}
              />
            )}
            {totals && (
              <p className="text-sm">
                Auftragsumfang: <span className="tabular-nums">{formatEuroCents(totals.netCents)}</span>{' '}
                netto, <span className="font-medium tabular-nums">{formatEuroCents(totals.grossCents)}</span>{' '}
                brutto
              </p>
            )}
            <Field label="Notiz" htmlFor={FIELD.note}>
              <Textarea
                id={FIELD.note}
                value={form.note}
                maxLength={2000}
                onChange={(event) => update({ note: event.target.value })}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending} disabled={isPending}>
              Annahme erfassen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Who accepted, on which day and how. */
function AcceptanceFacts({
  form,
  update,
  errors,
}: {
  form: AcceptanceForm;
  update: (patch: Partial<AcceptanceForm>) => void;
  errors: FieldErrors;
}) {
  return (
    <>
      <Field label="Angenommen von" htmlFor={FIELD.name} required error={errors[FIELD.name]}>
        <Input
          id={FIELD.name}
          value={form.name}
          maxLength={200}
          onChange={(event) => update({ name: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Angenommen am" htmlFor={FIELD.date} required error={errors[FIELD.date]}>
          <DatePicker
            id={FIELD.date}
            ariaLabel="Angenommen am"
            value={form.acceptedOn ? new Date(`${form.acceptedOn}T00:00:00`) : undefined}
            onChange={(date) => update({ acceptedOn: date ? toLocalDateString(date) : '' })}
          />
        </Field>
        <Field label="Angenommen per" htmlFor={FIELD.channel} required error={errors[FIELD.channel]}>
          <Select
            value={form.channel ?? ''}
            onValueChange={(value) =>
              update({ channel: ACCEPTANCE_CHANNELS.find((option) => option === value) ?? null })
            }
          >
            <SelectTrigger id={FIELD.channel} className="w-full">
              <SelectValue placeholder="Auswählen" />
            </SelectTrigger>
            <SelectContent>
              {ACCEPTANCE_CHANNELS.map((option) => (
                <SelectItem key={option} value={option}>
                  {ACCEPTANCE_CHANNEL_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </>
  );
}

/** The revision's Bedarfs- and Alternativpositionen to tick; one Alternativposition per replaced Position. */
function AcceptanceOptions({
  options,
  chosen,
  onChange,
}: {
  options: readonly OfferOption[];
  chosen: readonly string[];
  onChange: (chosen: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Gewählte Optionen</legend>
      {options.map((option) => (
        <div key={option.number} className="flex items-start gap-2">
          <Checkbox
            id={`offer-accept-option-${option.number}`}
            checked={chosen.includes(option.number)}
            onCheckedChange={(checked) => onChange(toggled(options, chosen, option, checked === true))}
          />
          <Label
            htmlFor={`offer-accept-option-${option.number}`}
            className="text-sm font-normal wrap-anywhere"
          >
            {optionLabel(option)}
          </Label>
        </div>
      ))}
    </fieldset>
  );
}
