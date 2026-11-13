'use client';

import { useState, type FormEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { saveCompanyDocumentProfile } from '@/lib/company-profile/actions';
import {
  STANDARD_TAX_RATE_OPTIONS,
  missingLetterDetails,
  type CompanyProfileDetails,
} from '@/lib/company-profile/profile';
import { NOTHING_TO_SAVE } from '@/lib/settings/save-answers';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

import {
  MARGIN_SIDES,
  TEXT_FIELD_SECTIONS,
  profileDraftOf,
  fieldId,
  hiddenMarginPages,
  withSavedMargins,
  parseDraft,
  type MarginPage,
  type ProfileDraft,
  type TextFieldDefinition,
} from './document-profile-draft';

const SAVE_FAILURES = {
  not_authorized: 'Nur Admins und das Büro können die Firmenangaben ändern.',
  profile_changed:
    'Jemand hat die Angaben inzwischen geändert. Lade die Seite neu und trag deine Änderung noch einmal ein.',
  organization_changed:
    'Inzwischen ist eine andere Organisation aktiv. Lade die Seite neu und trag deine Änderung noch einmal ein.',
  margins_leave_no_room:
    'Mit diesen Rändern bleibt zu wenig Platz für das Angebot. Verkleinere die Ränder des Briefpapiers.',
} satisfies Record<string, string>;
const SAVE_FAILED = 'Die Firmenangaben konnten nicht gespeichert werden. Versuch es noch einmal.';

type FormProps = {
  /** The organization whose saved profile the form shows. */
  organizationId: string;
  version: number;
  details: CompanyProfileDetails;
  /** Which pages have stationery; only those show their margins. */
  stationery: { first: boolean; following: boolean };
};

/** The usual details of a business letter the saved profile lacks; it blocks nothing. */
function MissingDetailsHint({ details }: { details: CompanyProfileDetails }) {
  const missing = missingLetterDetails(details);
  if (missing.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-info/30 bg-info-soft p-3 text-sm text-info-soft-foreground"
    >
      <p>
        Ein Geschäftsbrief nennt üblicherweise Firma mit Rechtsform, Anschrift, Registergericht und
        Registernummer, Geschäftsführung oder Inhaber, Steuernummer oder USt-IdNr. und eine Bankverbindung.
      </p>
      <p className="mt-1 font-medium">Noch nicht hinterlegt: {missing.join(', ')}.</p>
    </div>
  );
}

function ProfileTextField({
  field,
  draft,
  error,
  disabled,
  onChange,
}: {
  field: TextFieldDefinition;
  draft: ProfileDraft;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = fieldId(field.key);
  return (
    <Field label={field.label} htmlFor={id} description={field.description} error={error}>
      {field.multiline ? (
        <Textarea
          id={id}
          rows={3}
          value={draft[field.key]}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={draft[field.key]}
          autoComplete={field.autoComplete}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function OfferDefaultsFields({
  draft,
  errors,
  disabled,
  update,
}: {
  draft: ProfileDraft;
  errors: Record<string, string>;
  disabled: boolean;
  update: (change: Partial<ProfileDraft>) => void;
}) {
  const validityId = fieldId('offerValidityDays');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Gültigkeit in Tagen"
        htmlFor={validityId}
        description="So lange gilt ein neues Angebot ab seinem Datum."
        error={errors[validityId]}
      >
        <Input
          id={validityId}
          inputMode="numeric"
          value={draft.offerValidityDays}
          disabled={disabled}
          onChange={(event) => update({ offerValidityDays: event.target.value })}
        />
      </Field>
      <Field
        label="Steuersatz ohne Artikel"
        htmlFor={fieldId('standardTaxRateBasisPoints')}
        description="Gilt für Positionen, die keinen Artikel mit eigenem Steuersatz haben."
      >
        <Select
          value={String(draft.standardTaxRateBasisPoints)}
          disabled={disabled}
          onValueChange={(value) => update({ standardTaxRateBasisPoints: Number(value) })}
        >
          <SelectTrigger id={fieldId('standardTaxRateBasisPoints')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STANDARD_TAX_RATE_OPTIONS.map((option) => (
              <SelectItem key={option.basisPoints} value={String(option.basisPoints)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function MarginFields({
  page,
  title,
  draft,
  errors,
  disabled,
  update,
}: {
  page: MarginPage;
  title: string;
  draft: ProfileDraft;
  errors: Record<string, string>;
  disabled: boolean;
  update: (change: Partial<ProfileDraft>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {MARGIN_SIDES.map(({ side, label }) => {
          const id = fieldId(page, side);
          return (
            <Field key={side} label={`${label} (mm)`} htmlFor={id} error={errors[id]}>
              <Input
                id={id}
                inputMode="numeric"
                value={draft[page][side]}
                disabled={disabled}
                onChange={(event) => update({ [page]: { ...draft[page], [side]: event.target.value } })}
              />
            </Field>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The form's draft and its save: parse, mark and focus invalid fields, then
 * one save call. The save names the organization and version the draft was
 * loaded from, so the server refuses it once another organization is active.
 */
function useProfileSave({ organizationId, version, details, stationery }: FormProps) {
  const { showBanner } = useBanner();
  const { run, isPending } = useServerAction(saveCompanyDocumentProfile);
  const [loaded] = useState(() => ({ organizationId, version }));
  const [draft, setDraft] = useState(() => profileDraftOf(details));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Removed stationery hides its margins without a new version. A hidden group
  // returns to the saved margins, so no field nobody sees blocks the save.
  const [shownStationery, setShownStationery] = useState(stationery);
  if (shownStationery.first !== stationery.first || shownStationery.following !== stationery.following) {
    setShownStationery(stationery);
    const restored = withSavedMargins(draft, errors, details, hiddenMarginPages(stationery));
    setDraft(restored.draft);
    setErrors(restored.errors);
  }
  const [failure, setFailure] = useState<string | null>(null);
  const update = (change: Partial<ProfileDraft>) => setDraft((current) => ({ ...current, ...change }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    const parsed = parseDraft(draft);
    if (parsed.kind === 'invalid') {
      setErrors(parsed.errors);
      focusFirstInvalidField(parsed.errors);
      return;
    }
    setErrors({});
    // A lost connection rejects the call: the draft stays and the failure shows like a refusal.
    const result = await run({
      organizationId: loaded.organizationId,
      expectedVersion: loaded.version,
      details: parsed.details,
    }).catch(() => ({ success: false, error: 'save_failed' }) as const);
    if (result.success) {
      // The answer renders the route with the saved profile, which remounts this form.
      showBanner({ variant: 'success', message: 'Die Firmenangaben wurden gespeichert.' });
      return;
    }
    if (result.error === 'no_changes') showBanner(NOTHING_TO_SAVE);
    else setFailure(describeFailure(result.error, SAVE_FAILURES, SAVE_FAILED));
  };
  return { controls: { draft, errors, disabled: isPending, update }, submit, isPending, failure };
}

type DraftControls = ReturnType<typeof useProfileSave>['controls'];

function StationeryMargins({ controls, following }: { controls: DraftControls; following: boolean }) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Ränder bei Briefpapier</h3>
      <p className="text-sm text-muted-foreground">
        So viel Abstand hält das Angebot zum Papierrand, damit Briefkopf und Fuß deines Briefpapiers frei
        bleiben.
      </p>
      <MarginFields page="firstPageMargins" title="Erste Seite" {...controls} />
      {following && <MarginFields page="followingPageMargins" title="Folgeseiten" {...controls} />}
    </section>
  );
}

/**
 * The company's details and offer defaults, saved together with their
 * history. Another organization or a saved version mounts a new form, so the
 * draft always starts from the profile shown.
 */
export function DocumentCompanyProfileForm(props: FormProps) {
  return <CompanyProfileForm key={`${props.organizationId}:${props.version}`} {...props} />;
}

function CompanyProfileForm(profile: FormProps) {
  const { stationery } = profile;
  const { controls, submit, isPending, failure } = useProfileSave(profile);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Firmenangaben
          <InlinePending active={isPending} label="Firmenangaben werden gespeichert" />
        </CardTitle>
        <CardDescription>Diese Angaben stehen im Briefkopf und im Fuß jedes Angebots.</CardDescription>
      </CardHeader>
      <form onSubmit={submit} noValidate>
        <CardContent className="space-y-6">
          <MissingDetailsHint details={profile.details} />
          {TEXT_FIELD_SECTIONS.map((section) => (
            <section key={section.title} className="space-y-4">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <ProfileTextField
                    key={field.key}
                    field={field}
                    draft={controls.draft}
                    error={controls.errors[fieldId(field.key)]}
                    disabled={isPending}
                    onChange={(value) => controls.update({ [field.key]: value })}
                  />
                ))}
              </div>
            </section>
          ))}
          <OfferDefaultsFields {...controls} />
          {stationery.first && <StationeryMargins controls={controls} following={stationery.following} />}
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
          <ErrorText>{failure}</ErrorText>
          <Button type="submit" disabled={isPending} className="sm:ml-auto">
            Angaben speichern
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
