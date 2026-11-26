'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { parseDays, parsePercentBasisPoints, percentInput } from '@/lib/invoices/draft-form';
import type { InvoiceSettings, InvoiceSettingsValues } from '@/lib/invoices/settings';
import { saveInvoiceSettings } from '@/lib/invoices/settings-actions';
import { NOTHING_TO_SAVE } from '@/lib/settings/save-answers';
import { parseWholeNumberInput } from '@/lib/ui/decimal';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const FIELD_IDS = {
  prefix: 'invoice-settings-prefix',
  minDigits: 'invoice-settings-min-digits',
  nextNumber: 'invoice-settings-next-number',
  paymentDueDays: 'invoice-settings-payment-due',
  discountPercent: 'invoice-settings-discount-percent',
  discountDays: 'invoice-settings-discount-days',
} as const;

const MESSAGES: Readonly<Record<string, string>> = {
  organization_changed:
    'Du hast inzwischen die Organisation gewechselt. Lade die Seite neu, bevor du Einstellungen speicherst.',
  not_authorized: 'Nur Admins ändern die Rechnungseinstellungen.',
  stale_version: 'Jemand hat die Einstellungen inzwischen geändert. Lade die Seite neu.',
  invoice_year_changed:
    'Inzwischen hat ein neues Jahr begonnen, und der Nummernkreis beginnt wieder bei 1. Lade die Seite neu und prüfe die nächste Nummer.',
  save_failed: 'Die Einstellungen konnten nicht gespeichert werden. Bitte versuche es erneut.',
};

type Form = {
  prefix: string;
  withYear: boolean;
  minDigits: string;
  nextNumber: string;
  paymentDueDays: string;
  discountPercent: string;
  discountDays: string;
};

function settingsFormOf(settings: InvoiceSettings): Form {
  return {
    prefix: settings.numberPrefix,
    withYear: settings.numberWithYear,
    minDigits: String(settings.numberMinDigits),
    nextNumber: String(settings.nextNumber),
    paymentDueDays: String(settings.paymentDueDays),
    discountPercent: percentInput(settings.discountBasisPoints),
    discountDays: settings.discountDays === null ? '' : String(settings.discountDays),
  };
}

/** The typed settings, or the message of each field at fault. */
function parseForm(
  form: Form,
):
  | { ok: true; values: Omit<InvoiceSettingsValues, 'numberYear'> }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!/^[A-Za-z0-9._/-]{0,20}$/.test(form.prefix.trim())) {
    errors[FIELD_IDS.prefix] = 'Höchstens 20 Zeichen: Buchstaben, Ziffern und . _ / -.';
  }
  const minDigits = parseWholeNumberInput(form.minDigits, 1, 10);
  if (minDigits === null) errors[FIELD_IDS.minDigits] = 'Gib eine Zahl von 1 bis 10 an.';
  const nextNumber = parseWholeNumberInput(form.nextNumber, 1, 999_999_999);
  if (nextNumber === null) errors[FIELD_IDS.nextNumber] = 'Gib eine ganze Zahl ab 1 an.';
  const paymentDueDays = parseDays(form.paymentDueDays, 0);
  if (paymentDueDays === null)
    errors[FIELD_IDS.paymentDueDays] = 'Gib das Zahlungsziel in Tagen an (0 bis 365).';
  const hasDiscount = form.discountPercent.trim() !== '' || form.discountDays.trim() !== '';
  const discountBasisPoints = hasDiscount ? parsePercentBasisPoints(form.discountPercent) : null;
  const discountDays = hasDiscount ? parseDays(form.discountDays, 1) : null;
  if (hasDiscount && discountBasisPoints === null) {
    errors[FIELD_IDS.discountPercent] = 'Gib den Skonto in Prozent an, zum Beispiel 2 oder 2,5.';
  }
  if (hasDiscount && (discountDays === null || (paymentDueDays !== null && discountDays > paymentDueDays))) {
    errors[FIELD_IDS.discountDays] = 'Gib die Skontofrist in Tagen an, höchstens bis zum Zahlungsziel.';
  }
  if (
    Object.keys(errors).length > 0 ||
    minDigits === null ||
    nextNumber === null ||
    paymentDueDays === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: {
      numberPrefix: form.prefix.trim(),
      numberWithYear: form.withYear,
      numberMinDigits: minDigits,
      nextNumber,
      paymentDueDays,
      discountDays,
      discountBasisPoints,
    },
  };
}

type FieldProps = {
  form: Form;
  update: (patch: Partial<Form>) => void;
  errors: Record<string, string>;
  disabled: boolean;
};

function NumberSeriesFields({
  form,
  update,
  errors,
  disabled,
  settings,
}: FieldProps & { settings: InvoiceSettings }) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Rechnungsnummern</h3>
      <p className="text-sm text-muted-foreground">
        {settings.nextInvoiceNumber === null ? (
          'Der Nummernkreis ist ausgeschöpft: Es gibt keine weitere Rechnungsnummer.'
        ) : (
          <>
            Die nächste Rechnung erhält die Nummer{' '}
            <span className="font-medium text-foreground">{settings.nextInvoiceNumber}</span>.
          </>
        )}
        {settings.numbersFixed
          ? ' Seit der ersten ausgestellten Rechnung ist der Nummernkreis fest, damit keine Nummer fehlt oder doppelt vorkommt.'
          : ' Präfix, Jahr, Stellen und nächste Nummer legst du einmal vor der ersten Rechnung fest, zum Beispiel um die Nummern deiner bisherigen Software fortzuführen. Kürzere Nummern beginnen mit Nullen.'}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Präfix" htmlFor={FIELD_IDS.prefix} error={errors[FIELD_IDS.prefix]}>
          <Input
            value={form.prefix}
            onChange={(event) => update({ prefix: event.target.value })}
            maxLength={20}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
        <Field label="Mindestens Stellen" htmlFor={FIELD_IDS.minDigits} error={errors[FIELD_IDS.minDigits]}>
          <Input
            inputMode="numeric"
            value={form.minDigits}
            onChange={(event) => update({ minDigits: event.target.value })}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
        <Field label="Nächste Nummer" htmlFor={FIELD_IDS.nextNumber} error={errors[FIELD_IDS.nextNumber]}>
          <Input
            inputMode="numeric"
            value={form.nextNumber}
            onChange={(event) => update({ nextNumber: event.target.value })}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={form.withYear}
          disabled={disabled}
          onCheckedChange={(checked) => update({ withYear: checked === true })}
        />
        <span className="font-medium">
          Jahr in der Nummer
          <span className="block font-normal text-muted-foreground">
            Die Nummer enthält das Jahr des Rechnungsdatums und beginnt jedes Jahr wieder bei 1.
          </span>
        </span>
      </label>
    </section>
  );
}

function PaymentTermsFields({ form, update, errors, disabled }: FieldProps) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Zahlungsbedingungen für neue Entwürfe</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Zahlungsziel in Tagen"
          htmlFor={FIELD_IDS.paymentDueDays}
          required
          error={errors[FIELD_IDS.paymentDueDays]}
        >
          <Input
            inputMode="numeric"
            value={form.paymentDueDays}
            onChange={(event) => update({ paymentDueDays: event.target.value })}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
        <Field
          label="Skonto in %"
          htmlFor={FIELD_IDS.discountPercent}
          error={errors[FIELD_IDS.discountPercent]}
        >
          <Input
            inputMode="decimal"
            value={form.discountPercent}
            onChange={(event) => update({ discountPercent: event.target.value })}
            placeholder="Kein Skonto"
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
        <Field
          label="innerhalb Tagen"
          htmlFor={FIELD_IDS.discountDays}
          error={errors[FIELD_IDS.discountDays]}
        >
          <Input
            inputMode="numeric"
            value={form.discountDays}
            onChange={(event) => update({ discountDays: event.target.value })}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
      </div>
    </section>
  );
}

/** The form's text, its errors, and the save: unchanged answers „nothing to save“. */
function useSettingsSave(settings: InvoiceSettings, organizationId: string) {
  const { showBanner } = useBanner();
  const [form, setForm] = useState(() => settingsFormOf(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const { run, isPending } = useServerAction(saveInvoiceSettings);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseForm(form);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (!parsed.ok) {
      focusFirstInvalidField(parsed.errors);
      return;
    }
    if (JSON.stringify(form) === JSON.stringify(settingsFormOf(settings))) {
      showBanner(NOTHING_TO_SAVE);
      return;
    }
    setFailure(null);
    const result = await run({
      organizationId,
      expectedVersion: settings.version,
      settings: { ...parsed.values, numberYear: settings.numberYear },
    }).catch(() => null);
    if (!result?.success) {
      setFailure(describeFailure(result?.error ?? 'save_failed', MESSAGES, MESSAGES.save_failed ?? ''));
      return;
    }
    showBanner({ variant: 'success', message: 'Rechnungseinstellungen gespeichert.' });
  };
  return {
    form,
    update: (patch: Partial<Form>) => setForm({ ...form, ...patch }),
    errors,
    failure,
    isPending,
    submit,
  };
}

/**
 * Einstellungen → Rechnungen: the number series (fixed from the first issued
 * invoice on) and the Zahlungsziel and Skonto a new draft starts with.
 * Admin changes them; Büro reads them.
 */
export function InvoiceSettingsForm({
  organizationId,
  settings,
  canEdit,
}: {
  organizationId: string;
  settings: InvoiceSettings;
  canEdit: boolean;
}) {
  const { form, update, errors, failure, isPending, submit } = useSettingsSave(settings, organizationId);
  const disabled = !canEdit || isPending;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Nummernkreis und Zahlungsbedingungen
          <InlinePending active={isPending} label="Rechnungseinstellungen werden gespeichert" />
        </CardTitle>
        {!canEdit && <CardDescription>Nur Admins ändern diese Einstellungen.</CardDescription>}
      </CardHeader>
      <form onSubmit={submit} noValidate>
        <CardContent className="space-y-6">
          <NumberSeriesFields
            form={form}
            update={update}
            errors={errors}
            disabled={disabled || settings.numbersFixed}
            settings={settings}
          />
          <PaymentTermsFields form={form} update={update} errors={errors} disabled={disabled} />
        </CardContent>
        {canEdit && (
          <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
            <ErrorText>{failure}</ErrorText>
            <Button type="submit" pending={isPending} className="sm:ml-auto">
              Speichern
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
