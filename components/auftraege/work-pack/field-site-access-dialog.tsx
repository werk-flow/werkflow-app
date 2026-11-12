'use client';

import { useState, type ReactElement } from 'react';

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
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { proposeSiteAccess } from '@/lib/site-access-proposals/actions';
import {
  SITE_ACCESS_FIELD_IDS,
  SITE_ACCESS_LIMITS,
  siteAccessProposalErrors,
  type SiteAccessProposalValues,
} from '@/lib/site-access-proposals/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

// Loaded on the worker's intent through components/shared/lazy-dialog.tsx, so
// the field work pack's cold start never carries the form (`lab.field.cold-start`).

const PROPOSE_FAILURES = {
  job_not_found: 'Diesen Auftrag gibt es nicht mehr. Lade die Seite neu.',
  not_authorized: 'Du bist diesem Auftrag nicht mehr zugeteilt.',
  site_not_on_job: 'Der Einsatzort dieses Auftrags hat sich geändert. Lade die Seite neu.',
};

const PROPOSE_FALLBACK = 'Dein Hinweis konnte nicht gesendet werden. Versuche es in einem Moment erneut.';

/** The proposal form; it loads when the worker reaches for the Einsatzort's pencil. */
export function SiteAccessProposalDialog({
  open,
  onOpenChange,
  jobId,
  siteId,
  initialValues,
  notice,
  settle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  siteId: string;
  initialValues: SiteAccessProposalValues;
  /** The latest proposal's state: still open, taken, or declined with the office's reason. */
  notice: string | null;
  /** Waits for the page's refreshed proposal state after a sent proposal. */
  settle: () => Promise<void>;
}): ReactElement {
  const { showBanner } = useBanner();
  // Only a saved proposal changes the page; a refused one keeps it as it was.
  const { run, isPending } = useServerAction(proposeSiteAccess, {
    settle: (result) => (result.success ? settle() : Promise.resolve()),
  });
  const onClose = () => onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent size="md">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Zugang korrigieren</DialogTitle>
            <DialogDescription>
              Das Büro prüft deinen Hinweis, bevor er beim Einsatzort gespeichert wird.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            {notice && <p className="rounded-md bg-muted p-3 text-sm wrap-anywhere">{notice}</p>}
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
