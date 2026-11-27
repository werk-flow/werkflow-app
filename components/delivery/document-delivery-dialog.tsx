'use client';

import { Mail, Stamp } from 'lucide-react';
import { useState, type FormEvent, type ReactElement } from 'react';

import { DeliveryEntryList, type RetryDelivery } from '@/components/delivery/delivery-entry-list';
import { MailFields, mailErrors, sendBanner } from '@/components/delivery/mail-fields';
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
import { Input } from '@/components/ui/input';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientRead } from '@/hooks/use-client-read';
import { usePayloadAttemptKey, type PayloadAttemptKey } from '@/hooks/use-payload-attempt-key';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import {
  DELIVERY_LIMITS,
  type DeliveryMailDefaults,
  type DeliveryState,
  type DeliveryView,
} from '@/lib/delivery/delivery-types';
import { priorEmailAdvice } from '@/lib/delivery/failure-advice';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

// „Versand“ of one filed document through E2c's delivery (lib/delivery/):
// its sends with their state, „Erneut senden“ for a failed one, „Per E-Mail
// senden“ with the filed PDF, and „Als manuell versendet markieren“ where the
// host records manual sends. One dialog with its steps, so no dialog opens
// over another. Each host binds its actions to its document and names its
// words; a document that takes no further send lists its sends read-only.

const SEND_FAILED = 'Die E-Mail konnte nicht versendet werden. Bitte versuche es erneut.';
const RECORD_FAILED = 'Der Versand konnte nicht vermerkt werden. Bitte versuche es erneut.';

type Step = 'overview' | 'email' | 'manual';

type SendOutcome = ActionResult<{ state: DeliveryState; failureCode: string | null }>;

/** The host's send of its document, bound to it: one filled form under one attempt key. */
type SendEmail = (input: DeliveryMailDefaults & { attemptKey: string }) => Promise<SendOutcome>;

/** The host's record of a send by post or by hand, bound to its document. */
type RecordManual = (input: { attemptKey: string; note: string }) => Promise<ActionResult>;

export type DocumentDeliveryHost = {
  /** The dialog's title, such as „Servicebericht versenden“. */
  title: string;
  /** The document as the description starts, such as „12.11.2037 · WP-0004“. */
  label: string;
  /** The document as a banner names it, such as „Der Servicebericht“. */
  documentName: string;
  /** What each step says below the label. */
  descriptions: { overview: string; email: string; manual?: string };
  empty: { title: string; description: string };
  /** The sentences of the host's refusal codes, beside lib/delivery/'s own. */
  failures: Readonly<Record<string, string>>;
  /** What a failed read of the sends says. */
  loadFailure: string;
  /** Reads the sends and the email's proposal; `readKey` names what it reads. */
  read: (signal: AbortSignal) => Promise<ActionResult<{ delivery: DeliveryView }>>;
  readKey: readonly (string | number)[];
  /** Why the document takes no further send; its sends are then listed read-only. */
  closed?: string;
};

/** A step's action, owned by the dialog so it stays open while the request runs. */
type StepAction<Action extends (...args: never[]) => Promise<unknown>> = {
  run: Action;
  isPending: boolean;
};

const NO_MANUAL: RecordManual = async () => ({ success: false, error: 'not_authorized' });

/** The manual step's note and its attempt key, kept by the dialog until the record is confirmed. */
type NoteDraft = { value: string; set: (note: string) => void; attempt: PayloadAttemptKey };

/** What the server stores of an email, trimmed as it trims it. */
const mailPayload = (form: DeliveryMailDefaults) =>
  JSON.stringify([form.recipient.trim(), form.subject.trim(), form.text.trim()]);

/**
 * The email step: the filed PDF to one recipient, once per filled form. The
 * dialog keeps the form and its attempt key, so a send the provider refused
 * returns to the sends, where „Erneut senden“ repeats it, and a new email
 * starts from what the office typed.
 */
function EmailStep({
  host,
  action,
  form,
  setForm,
  attempt,
  sentBefore,
  onDone,
  onBack,
}: {
  host: DocumentDeliveryHost;
  action: StepAction<SendEmail>;
  form: DeliveryMailDefaults;
  setForm: (form: DeliveryMailDefaults) => void;
  attempt: PayloadAttemptKey;
  sentBefore: string | null;
  /** The send's answer: one that went out closes the dialog, a failure returns to the sends. */
  onDone: (state: DeliveryState) => void;
  onBack: () => void;
}): ReactElement {
  const { showBanner } = useBanner();
  const { run, isPending } = action;
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = attempted ? mailErrors(form) : {};
  const change = (patch: Partial<DeliveryMailDefaults>) => setForm({ ...form, ...patch });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(mailErrors(form))) return;
    setError(null);
    const attemptKey = attempt.keyFor(mailPayload(form));
    const result = await run({ attemptKey, ...form }).catch(() => null);
    if (!result) return setError(SEND_FAILED);
    if (!result.success) return setError(describeFailure(result.error, host.failures, SEND_FAILED));
    attempt.settle();
    showBanner(sendBanner(result, host.documentName, form.recipient.trim()));
    onDone(result.state);
  };
  return (
    <form onSubmit={submit} className="contents" noValidate aria-busy={isPending || undefined}>
      <DialogBody className="space-y-4 py-1">
        {sentBefore && <p className="text-sm text-muted-foreground">{sentBefore}</p>}
        {/* The fields keep the pressed mail until its answer, so a lost answer is pressed again unchanged. */}
        <fieldset disabled={isPending} className="contents">
          <MailFields form={form} errors={errors} change={change} />
        </fieldset>
        <ErrorText>{error}</ErrorText>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={isPending}>
          Zurück
        </Button>
        <Button type="submit" pending={isPending} disabled={isPending}>
          Senden
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The manual step: the office sent the document itself; WerkFlow sends nothing. */
function ManualStep({
  host,
  action,
  note,
  onDone,
  onBack,
}: {
  host: DocumentDeliveryHost;
  action: StepAction<RecordManual>;
  note: NoteDraft;
  onDone: () => void;
  onBack: () => void;
}): ReactElement {
  const { showBanner } = useBanner();
  const { run, isPending } = action;
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const attemptKey = note.attempt.keyFor(note.value.trim());
    const result = await run({ attemptKey, note: note.value }).catch(() => null);
    if (!result) return setError(RECORD_FAILED);
    if (!result.success) return setError(describeFailure(result.error, host.failures, RECORD_FAILED));
    showBanner({ variant: 'success', message: `${host.documentName} ist als manuell versendet vermerkt.` });
    onDone();
  };
  return (
    <form onSubmit={submit} className="contents" noValidate aria-busy={isPending || undefined}>
      <DialogBody className="space-y-2 py-1">
        <Field label="Notiz" htmlFor="delivery-note" description="Zum Beispiel „per Post am 21.11.“">
          <Input
            value={note.value}
            onChange={(event) => note.set(event.target.value)}
            maxLength={DELIVERY_LIMITS.note}
            disabled={isPending}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={isPending}>
          Zurück
        </Button>
        <Button type="submit" pending={isPending} disabled={isPending}>
          Als versendet markieren
        </Button>
      </DialogFooter>
    </form>
  );
}

type DeliveryRead = ReturnType<typeof useClientRead<ActionResult<{ delivery: DeliveryView }>>>;

/**
 * The sends of the document, or its read's skeleton, and the ways to send
 * it. A failed read shows with its retry, also beside the rows it read
 * before; a new send waits for a current read and for a running retry.
 */
function OverviewStep({
  host,
  read,
  retry,
  retrying,
  recordsManual,
  onClose,
  onStep,
}: {
  host: DocumentDeliveryHost;
  read: DeliveryRead;
  retry: RetryDelivery;
  retrying: boolean;
  recordsManual: boolean;
  onClose: () => void;
  onStep: (step: Step) => void;
}): ReactElement {
  const delivery = read.data?.delivery;
  const current = Boolean(delivery) && !read.loading && !read.failure && !retrying;
  const open = !host.closed;
  return (
    <>
      <DialogBody className="space-y-3 py-1" aria-busy={read.loading || undefined}>
        {read.failure && <SectionError failure={read.failure} />}
        {open && delivery && !delivery.defaults && !read.failure && (
          <SectionError onRetry={read.reload} retryPending={read.loading}>
            Die Vorschläge für die E-Mail konnten nicht geladen werden.
          </SectionError>
        )}
        {delivery ? (
          <DeliveryEntryList
            list={delivery.list}
            empty={host.empty}
            host={
              open ? { retry, stale: !current, failureMessages: host.failures, onChange: read.reload } : null
            }
          />
        ) : (
          !read.failure && <Skeleton className="h-16 w-full" />
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={retrying} onClick={onClose}>
          Schließen
        </Button>
        {open && recordsManual && (
          <Button type="button" variant="outline" disabled={!current} onClick={() => onStep('manual')}>
            <Stamp className="size-4" />
            Als manuell versendet markieren
          </Button>
        )}
        {open && (
          <Button type="button" disabled={!current || !delivery?.defaults} onClick={() => onStep('email')}>
            <Mail className="size-4" />
            Per E-Mail senden
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * What the office typed and the attempt key of each pressed send, kept by the
 * dialog across its steps until the server confirms them.
 */
function useDeliveryDrafts() {
  const [draft, setDraft] = useState<DeliveryMailDefaults | null>(null);
  const emailAttempt = usePayloadAttemptKey();
  const [note, setNote] = useState('');
  const noteDraft: NoteDraft = { value: note, set: setNote, attempt: usePayloadAttemptKey() };
  return { draft, setDraft, emailAttempt, noteDraft };
}

/**
 * The dialog. The host's actions are bound to its document: `send` one filled
 * form under its attempt key, `retry` a failed delivery, and `manual`, where
 * the host records sends by post, that record.
 */
export function DocumentDeliveryDialog({
  host,
  send,
  retry,
  manual,
  onClose,
}: {
  host: DocumentDeliveryHost;
  send: SendEmail;
  retry: RetryDelivery;
  manual?: RecordManual;
  onClose: () => void;
}): ReactElement {
  const [step, setStep] = useState<Step>('overview');
  const { draft, setDraft, emailAttempt, noteDraft } = useDeliveryDrafts();
  // Each prop is called inside its owner hook, so its press shows pending in its first frame.
  const sending = useServerAction((input: Parameters<SendEmail>[0]) => send(input));
  const recording = useServerAction((input: Parameters<RecordManual>[0]) =>
    manual ? manual(input) : NO_MANUAL(input),
  );
  const retrying = useServerAction((input: Parameters<RetryDelivery>[0]) => retry(input));
  const read = useClientRead({
    read: host.read,
    deps: host.readKey,
    failureMessage: (code) => describeFailure(code, host.failures, host.loadFailure),
  });
  const delivery = read.data?.delivery;
  // Success closes the dialog and its Banner confirms; a failed email returns to the sends,
  // where „Erneut senden“ repeats it.
  const sent = (state: DeliveryState) => {
    if (state !== 'failed') return onClose();
    setStep('overview');
    read.reload();
  };
  const back = () => setStep('overview');
  // The email step reads the sends again, so its note of an earlier email includes another session's.
  const openStep = (next: Step) => {
    setStep(next);
    if (next === 'email') read.reload();
  };
  const pending = sending.isPending || recording.isPending || retrying.isPending;
  // The email step opens on a current read of the sends, so its note of an earlier email is current too.
  const defaults = !read.loading && !read.failure ? delivery?.defaults : null;
  const shown: Step =
    host.closed || (step === 'email' && !defaults) || (step === 'manual' && !manual) ? 'overview' : step;
  const description = host.closed ?? host.descriptions[shown] ?? host.descriptions.overview;
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()} pending={pending}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{host.title}</DialogTitle>
          <DialogDescription>
            {host.label}. {description}
          </DialogDescription>
        </DialogHeader>
        {shown === 'email' && delivery && defaults ? (
          <EmailStep
            host={host}
            action={sending}
            form={draft ?? defaults}
            setForm={setDraft}
            attempt={emailAttempt}
            sentBefore={priorEmailAdvice(delivery.list.entries)}
            onDone={sent}
            onBack={back}
          />
        ) : shown === 'manual' ? (
          <ManualStep host={host} action={recording} note={noteDraft} onDone={onClose} onBack={back} />
        ) : (
          <OverviewStep
            host={host}
            read={read}
            retry={retrying.run}
            retrying={retrying.isPending}
            recordsManual={manual !== undefined}
            onClose={onClose}
            onStep={openStep}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
