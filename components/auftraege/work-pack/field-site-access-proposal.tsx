'use client';

import { DoorOpen } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { FieldWorkPackLoadError } from '@/components/auftraege/work-pack/field-work-pack-load-error';
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
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { proposeSiteAccess } from '@/lib/site-access-proposals/actions';
import {
  SITE_ACCESS_FIELD_IDS,
  SITE_ACCESS_LIMITS,
  siteAccessProposalErrors,
  type JobSiteAccessProposal,
  type JobSiteAccessProposalRead,
  type SiteAccessProposalValues,
} from '@/lib/site-access-proposals/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate } from '@/lib/utils';

const PROPOSE_FAILURES = {
  job_not_found: 'Diesen Auftrag gibt es nicht mehr. Lade die Seite neu.',
  not_authorized: 'Du bist diesem Auftrag nicht mehr zugeteilt.',
  site_not_on_job: 'Der Einsatzort dieses Auftrags hat sich geändert. Lade die Seite neu.',
};

const PROPOSE_FALLBACK = 'Dein Hinweis konnte nicht gesendet werden. Versuche es in einem Moment erneut.';

const EMPTY_VALUES: SiteAccessProposalValues = {
  contactName: '',
  contactPhone: '',
  contactNote: '',
  accessNotes: '',
};

/**
 * The field worker's way to tell the office that the access to the job's
 * Einsatzort is wrong, and what became of it. The proposal changes nothing at
 * the Einsatzort until the office accepts it in Aufgaben.
 */
export function FieldSiteAccessProposal({
  jobId,
  siteId,
  read,
}: {
  jobId: string;
  siteId: string;
  read: JobSiteAccessProposalRead;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const proposal = read.ok ? read.proposal : null;
  const settle = useSettleOnChange(read);
  // Owned here, so the Einsatzort shows the settling state after the dialog closed.
  const propose = useServerAction(proposeSiteAccess, { settle: () => settle() });
  const ownOpenValues = proposal?.status === 'open' ? proposal.values : null;

  return (
    <div className="mt-3 space-y-2" data-testid="field-site-access">
      {read.ok ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <SiteAccessProposalState proposal={proposal} />
          </div>
          <InlinePending active={propose.isSettling} label="Wird aktualisiert" />
        </div>
      ) : (
        <FieldWorkPackLoadError
          title="Zugangshinweis nicht geladen"
          description="Ob das Büro deinen Hinweis zum Zugang schon geprüft hat, ist gerade nicht bekannt."
        />
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <DoorOpen className="size-4" />
        {ownOpenValues ? 'Hinweis ändern' : 'Zugang stimmt nicht?'}
      </Button>
      {open && (
        <SiteAccessProposalDialog
          jobId={jobId}
          siteId={siteId}
          initialValues={ownOpenValues ?? EMPTY_VALUES}
          run={propose.run}
          isPending={propose.isPending}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SiteAccessProposalState({
  proposal,
}: {
  proposal: JobSiteAccessProposal | null;
}): ReactElement | null {
  if (!proposal) return null;
  if (proposal.status === 'open') {
    return (
      <div className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="status">
        <p className="font-medium">
          {proposal.proposedByMe
            ? 'Dein Hinweis zum Zugang liegt beim Büro.'
            : 'Ein Hinweis aus deinem Team zum Zugang liegt beim Büro.'}
        </p>
        {proposal.values && <ProposedValues values={proposal.values} />}
      </div>
    );
  }
  const decidedOn = proposal.decidedAt ? ` am ${formatGermanDate(proposal.decidedAt)}` : '';
  if (proposal.status === 'accepted') {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Das Büro hat den Hinweis zum Zugang{decidedOn} übernommen.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground" role="status">
      Das Büro hat den Hinweis zum Zugang{decidedOn} nicht übernommen
      {proposal.rejectionReason ? `: ${proposal.rejectionReason}` : '.'}
    </p>
  );
}

function ProposedValues({ values }: { values: SiteAccessProposalValues }): ReactElement {
  const contact = [values.contactName, values.contactPhone, values.contactNote].filter(Boolean).join(' · ');
  return (
    <div className="mt-1 space-y-0.5 wrap-anywhere">
      {contact && <p>Zugangskontakt: {contact}</p>}
      {values.accessNotes && <p className="whitespace-pre-wrap">Zugang: {values.accessNotes}</p>}
    </div>
  );
}

function SiteAccessProposalDialog({
  jobId,
  siteId,
  initialValues,
  run,
  isPending,
  onClose,
}: {
  jobId: string;
  siteId: string;
  initialValues: SiteAccessProposalValues;
  run: typeof proposeSiteAccess;
  isPending: boolean;
  onClose: () => void;
}): ReactElement {
  const { showBanner } = useBanner();
  const [values, setValues] = useState(initialValues);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = attempted ? siteAccessProposalErrors(values) : {};

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    const found = siteAccessProposalErrors(values);
    if (
      focusFirstInvalidField({
        [SITE_ACCESS_FIELD_IDS.contactName]: found.contactName,
        [SITE_ACCESS_FIELD_IDS.accessNotes]: found.accessNotes,
      })
    )
      return;
    setFailure(null);
    void (async () => {
      const result = await run({ jobId, siteId, ...values });
      if (!result.success) {
        setFailure(describeFailure(result.error, PROPOSE_FAILURES, PROPOSE_FALLBACK));
        return;
      }
      onClose();
      showBanner({ variant: 'success', message: 'Dein Hinweis ist beim Büro.' });
    })();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      pending={isPending}
    >
      <DialogContent size="md">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Zugang korrigieren</DialogTitle>
            <DialogDescription>
              Das Büro prüft deinen Hinweis, bevor er beim Einsatzort gespeichert wird.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <SiteAccessProposalFields values={values} errors={errors} onChange={setValues} />
            <ErrorText>{failure}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending} disabled={isPending}>
              An Büro senden
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Who lets the worker in, and how they get in. */
function SiteAccessProposalFields({
  values,
  errors,
  onChange,
}: {
  values: SiteAccessProposalValues;
  errors: Partial<Record<keyof SiteAccessProposalValues, string>>;
  onChange: (update: (current: SiteAccessProposalValues) => SiteAccessProposalValues) => void;
}): ReactElement {
  const set = (key: keyof SiteAccessProposalValues) => (value: string) =>
    onChange((current) => ({ ...current, [key]: value }));
  return (
    <>
      <Field
        label="Wer lässt dich rein?"
        htmlFor={SITE_ACCESS_FIELD_IDS.contactName}
        error={errors.contactName}
      >
        <Input
          value={values.contactName}
          onChange={(event) => set('contactName')(event.target.value)}
          maxLength={SITE_ACCESS_LIMITS.contactName}
          autoComplete="off"
        />
      </Field>
      <Field label="Telefon" htmlFor={SITE_ACCESS_FIELD_IDS.contactPhone}>
        <Input
          type="tel"
          inputMode="tel"
          value={values.contactPhone}
          onChange={(event) => set('contactPhone')(event.target.value)}
          maxLength={SITE_ACCESS_LIMITS.contactPhone}
          autoComplete="off"
        />
      </Field>
      <Field
        label="Hinweis zur Person"
        htmlFor={SITE_ACCESS_FIELD_IDS.contactNote}
        description="Zum Beispiel: Hausmeister, nur vormittags erreichbar"
      >
        <Input
          value={values.contactNote}
          onChange={(event) => set('contactNote')(event.target.value)}
          maxLength={SITE_ACCESS_LIMITS.contactNote}
          autoComplete="off"
        />
      </Field>
      <Field
        label="Wie kommst du rein?"
        htmlFor={SITE_ACCESS_FIELD_IDS.accessNotes}
        description="Ersetzt den bisherigen Zugangshinweis, wenn das Büro zustimmt."
        error={errors.accessNotes}
      >
        <Textarea
          value={values.accessNotes}
          onChange={(event) => set('accessNotes')(event.target.value)}
          maxLength={SITE_ACCESS_LIMITS.accessNotes}
          rows={3}
        />
      </Field>
    </>
  );
}
