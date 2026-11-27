'use client';

import { Mail, Stamp } from 'lucide-react';
import { useState, type FormEvent, type ReactElement } from 'react';

import { DeliveryEntryList, type RetryDelivery } from '@/components/delivery/delivery-entry-list';
import { DELIVERY_REFUSALS } from '@/components/delivery/delivery-messages';
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
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import { DELIVERY_LIMITS, type DeliveryMailDefaults } from '@/lib/delivery/delivery-types';
import { priorEmailAdvice } from '@/lib/delivery/failure-advice';
import {
  markServiceReportSentManually,
  retryServiceReportDelivery,
  sendServiceReportEmail,
} from '@/lib/service-reports/delivery-actions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

// „Versand“ of a Servicebericht through E2c's delivery: its sends with their
// state, „Erneut senden“ for a failed one, „Per E-Mail senden“ with the
// filed PDF, and „Als manuell versendet markieren“. One dialog with three
// steps, so no dialog opens over another.

const SEND_FAILED = 'Die E-Mail konnte nicht versendet werden. Bitte versuche es erneut.';
const RECORD_FAILED = 'Der Versand konnte nicht vermerkt werden. Bitte versuche es erneut.';

const REPORT_DELIVERY_FAILURES: Readonly<Record<string, string>> = {
  ...DELIVERY_REFUSALS,
  service_report_not_found: 'Diesen Servicebericht gibt es nicht mehr. Lade die Seite neu.',
  service_report_stale:
    'Inzwischen gibt es einen neueren Servicebericht dieses Besuchs. Versende den neueren aus der Liste.',
  document_not_found:
    'Die abgelegte Datei des Serviceberichts lässt sich nicht versenden. Erstelle ihn neu, dann kannst du ihn senden.',
  delivery_retry_expired:
    'Der Versand ist älter als einen Tag und lässt sich nicht mehr wiederholen. Sende den Servicebericht bei Bedarf neu per E-Mail.',
};

type Step = 'overview' | 'email' | 'manual';

/** A step's action, owned by the dialog so it stays open while the request runs. */
type StepAction<Action extends (...args: never[]) => Promise<unknown>> = {
  run: Action;
  isPending: boolean;
};

/**
 * The email step: the report's filed PDF to one recipient, once per filled
 * form. The dialog keeps the form, so a send the provider refused returns to
 * the sends, where „Erneut senden“ repeats it, and a new email starts from
 * what the office typed.
 */
function EmailStep({
  reportId,
  action,
  form,
  setForm,
  sentBefore,
  onDone,
  onBack,
}: {
  reportId: string;
  action: StepAction<typeof sendServiceReportEmail>;
  form: DeliveryMailDefaults;
  /** The form's new state; null once it went out. */
  setForm: (form: DeliveryMailDefaults | null) => void;
  sentBefore: string | null;
  onDone: () => void;
  onBack: () => void;
}): ReactElement {
  const { showBanner } = useBanner();
  const { run, isPending } = action;
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = attempted ? mailErrors(form) : {};
  const change = (patch: Partial<DeliveryMailDefaults>) => {
    setForm({ ...form, ...patch });
    setAttemptKey(crypto.randomUUID());
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(mailErrors(form))) return;
    setError(null);
    const result = await run({ reportId, attemptKey, ...form }).catch(() => null);
    if (!result) return setError(SEND_FAILED);
    if (!result.success)
      return setError(describeFailure(result.error, REPORT_DELIVERY_FAILURES, SEND_FAILED));
    if (result.state !== 'failed') setForm(null);
    showBanner(sendBanner(result, 'Der Servicebericht', form.recipient.trim()));
    onDone();
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

/** The manual step: the office sent the report itself; WerkFlow sends nothing. */
function ManualStep({
  reportId,
  action,
  onDone,
  onBack,
}: {
  reportId: string;
  action: StepAction<typeof markServiceReportSentManually>;
  onDone: () => void;
  onBack: () => void;
}): ReactElement {
  const { showBanner } = useBanner();
  const { run, isPending } = action;
  const [note, setNote] = useState('');
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const result = await run({ reportId, attemptKey, note }).catch(() => null);
    if (!result) return setError(RECORD_FAILED);
    if (!result.success)
      return setError(describeFailure(result.error, REPORT_DELIVERY_FAILURES, RECORD_FAILED));
    showBanner({ variant: 'success', message: 'Der Servicebericht ist als manuell versendet vermerkt.' });
    onDone();
  };
  return (
    <form onSubmit={submit} className="contents" noValidate aria-busy={isPending || undefined}>
      <DialogBody className="space-y-2 py-1">
        <Field label="Notiz" htmlFor="delivery-note" description="Zum Beispiel „per Post am 21.11.“">
          <Input
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setAttemptKey(crypto.randomUUID());
            }}
            maxLength={DELIVERY_LIMITS.note}
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

type DeliveryRead = ReturnType<typeof useClientRead<Awaited<ReturnType<typeof readDelivery>>>>;

const readDelivery = (reportId: string, signal: AbortSignal) =>
  readInBackground('service-report-delivery', { reportId }, signal);

/**
 * The sends of the report, or its read's skeleton, and the two ways to send
 * it. A failed read shows with its retry, also beside the rows it read
 * before; a new send waits for a current read and for a running retry.
 */
function OverviewStep({
  read,
  retry,
  retrying,
  onClose,
  onStep,
}: {
  read: DeliveryRead;
  retry: RetryDelivery;
  retrying: boolean;
  onClose: () => void;
  onStep: (step: Step) => void;
}): ReactElement {
  const delivery = read.data?.delivery;
  const current = Boolean(delivery) && !read.loading && !read.failure && !retrying;
  return (
    <>
      <DialogBody className="space-y-3 py-1" aria-busy={read.loading || undefined}>
        {read.failure && <SectionError failure={read.failure} />}
        {delivery && !delivery.defaults && !read.failure && (
          <SectionError onRetry={read.reload} retryPending={read.loading}>
            Die Vorschläge für die E-Mail konnten nicht geladen werden.
          </SectionError>
        )}
        {delivery ? (
          <DeliveryEntryList
            list={delivery.list}
            empty={{
              title: 'Noch kein Versand.',
              description: 'Sende den Servicebericht per E-Mail oder vermerke, dass er per Post rausging.',
            }}
            host={{
              retry,
              stale: !current,
              failureMessages: REPORT_DELIVERY_FAILURES,
              onChange: read.reload,
            }}
          />
        ) : (
          !read.failure && <Skeleton className="h-16 w-full" />
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={retrying} onClick={onClose}>
          Schließen
        </Button>
        <Button type="button" variant="outline" disabled={!current} onClick={() => onStep('manual')}>
          <Stamp className="size-4" />
          Als manuell versendet markieren
        </Button>
        <Button type="button" disabled={!current || !delivery?.defaults} onClick={() => onStep('email')}>
          <Mail className="size-4" />
          Per E-Mail senden
        </Button>
      </DialogFooter>
    </>
  );
}

const STEP_DESCRIPTIONS: Record<Step, string> = {
  overview: 'Der Bericht hängt als PDF an, genau wie er abgelegt ist.',
  email: 'Der Bericht hängt als PDF an, genau wie er abgelegt ist. Prüfe Empfänger und Text.',
  manual: 'Für einen Bericht, der per Post oder persönlich rausging. WerkFlow verschickt dabei nichts.',
};

export function ServiceReportDeliveryDialog({
  reportId,
  visitLabel,
  onClose,
}: {
  reportId: string;
  /** The visit as the list names it, for example „12.11.2037 · WP-0004“. */
  visitLabel: string;
  onClose: () => void;
}): ReactElement {
  const [step, setStep] = useState<Step>('overview');
  const [draft, setDraft] = useState<DeliveryMailDefaults | null>(null);
  const send = useServerAction(sendServiceReportEmail);
  const manual = useServerAction(markServiceReportSentManually);
  const retry = useServerAction(retryServiceReportDelivery);
  const read = useClientRead({
    read: (signal) => readDelivery(reportId, signal),
    deps: [reportId],
    failureMessage: (code) =>
      describeFailure(
        code,
        REPORT_DELIVERY_FAILURES,
        'Der Versand dieses Serviceberichts konnte nicht geladen werden.',
      ),
  });
  const delivery = read.data?.delivery;
  const done = () => {
    setStep('overview');
    read.reload();
  };
  const back = () => setStep('overview');
  // The email step reads the sends again, so its note of an earlier email includes another session's.
  const open = (next: Step) => {
    setStep(next);
    if (next === 'email') read.reload();
  };
  const pending = send.isPending || manual.isPending || retry.isPending;
  // The email step opens on a current read of the sends, so its note of an earlier email is current too.
  const defaults = !read.loading && !read.failure ? delivery?.defaults : null;
  const shown: Step = step === 'email' && !defaults ? 'overview' : step;
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()} pending={pending}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Servicebericht versenden</DialogTitle>
          <DialogDescription>
            {visitLabel}. {STEP_DESCRIPTIONS[shown]}
          </DialogDescription>
        </DialogHeader>
        {shown === 'email' && delivery && defaults ? (
          <EmailStep
            reportId={reportId}
            action={send}
            form={draft ?? defaults}
            setForm={setDraft}
            sentBefore={priorEmailAdvice(delivery.list.entries)}
            onDone={done}
            onBack={back}
          />
        ) : shown === 'manual' ? (
          <ManualStep reportId={reportId} action={manual} onDone={done} onBack={back} />
        ) : (
          <OverviewStep
            read={read}
            retry={retry.run}
            retrying={retry.isPending}
            onClose={onClose}
            onStep={open}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
