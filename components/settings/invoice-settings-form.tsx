'use client';

import { useRouter } from 'next/navigation';
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
  not_authorized: 'Nur Admins ändern die Rechnungseinstellungen.',
  stale_version: 'Jemand hat die Einstellungen inzwischen geändert. Lade die Seite neu.',
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

function formOf(settings: InvoiceSettings): Form {
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

function wholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\d{1,9}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
}

/** The typed settings, or the message of each field at fault. */
function parseForm(
  form: Form,
): { ok: true; values: InvoiceSettingsValues } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!/^[A-Za-z0-9._/-]{0,20}$/.test(form.prefix.trim())) {
    errors[FIELD_IDS.prefix] = 'Höchstens 20 Zeichen: Buchstaben, Ziffern und . _ / -.';
  }
  const minDigits = wholeNumber(form.minDigits, 1, 10);
  if (minDigits === null) errors[FIELD_IDS.minDigits] = 'Gib eine Zahl von 1 bis 10 an.';
  const nextNumber = wholeNumber(form.nextNumber, 1, 999_999_998);
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

/** One text input of the form with its label and error. */
function TextField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  ...input
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  disabled: boolean;
  required?: boolean;
  inputMode?: 'numeric' | 'decimal';
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <Field label={label} htmlFor={id} error={error} {...(input.required ? { required: true } : {})}>
      <Input
        inputMode={input.inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={input.maxLength}
        placeholder={input.placeholder}
        autoComplete="off"
        disabled={disabled}
      />
    </Field>
  );
}

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
        Die nächste Rechnung erhält die Nummer{' '}
        <span className="font-medium text-foreground">{settings.nextInvoiceNumber}</span>.
        {settings.numbersFixed
          ? ' Seit der ersten ausgestellten Rechnung ist der Nummernkreis fest, damit keine Nummer fehlt oder doppelt vorkommt.'
          : ' Präfix, Jahr, Stellen und nächste Nummer legst du einmal vor der ersten Rechnung fest, zum Beispiel um die Nummern deiner bisherigen Software fortzuführen. Kürzere Nummern beginnen mit Nullen.'}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          id={FIELD_IDS.prefix}
          label="Präfix"
          value={form.prefix}
          onChange={(prefix) => update({ prefix })}
          maxLength={20}
          error={errors[FIELD_IDS.prefix]}
          disabled={disabled}
        />
        <TextField
          id={FIELD_IDS.minDigits}
          label="Mindestens Stellen"
          inputMode="numeric"
          value={form.minDigits}
          onChange={(minDigits) => update({ minDigits })}
          error={errors[FIELD_IDS.minDigits]}
          disabled={disabled}
        />
        <TextField
          id={FIELD_IDS.nextNumber}
          label="Nächste Nummer"
          inputMode="numeric"
          value={form.nextNumber}
          onChange={(nextNumber) => update({ nextNumber })}
          error={errors[FIELD_IDS.nextNumber]}
          disabled={disabled}
        />
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
        <TextField
          id={FIELD_IDS.paymentDueDays}
          label="Zahlungsziel in Tagen"
          required
          inputMode="numeric"
          value={form.paymentDueDays}
          onChange={(paymentDueDays) => update({ paymentDueDays })}
          error={errors[FIELD_IDS.paymentDueDays]}
          disabled={disabled}
        />
        <TextField
          id={FIELD_IDS.discountPercent}
          label="Skonto in %"
          inputMode="decimal"
          placeholder="Kein Skonto"
          value={form.discountPercent}
          onChange={(discountPercent) => update({ discountPercent })}
          error={errors[FIELD_IDS.discountPercent]}
          disabled={disabled}
        />
        <TextField
          id={FIELD_IDS.discountDays}
          label="innerhalb Tagen"
          inputMode="numeric"
          value={form.discountDays}
          onChange={(discountDays) => update({ discountDays })}
          error={errors[FIELD_IDS.discountDays]}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

/** The form's text, its errors, and the save: unchanged answers „nothing to save“. */
function useSettingsSave(settings: InvoiceSettings) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [form, setForm] = useState(() => formOf(settings));
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
    if (JSON.stringify(form) === JSON.stringify(formOf(settings))) {
      showBanner(NOTHING_TO_SAVE);
      return;
    }
    setFailure(null);
    const result = await run({ expectedVersion: settings.version, settings: parsed.values }).catch(
      () => null,
    );
    if (!result?.success) {
      setFailure(describeFailure(result?.error ?? 'save_failed', MESSAGES, MESSAGES.save_failed ?? ''));
      return;
    }
    showBanner({ variant: 'success', message: 'Rechnungseinstellungen gespeichert.' });
    router.refresh();
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
export function InvoiceSettingsForm({ settings, canEdit }: { settings: InvoiceSettings; canEdit: boolean }) {
  const { form, update, errors, failure, isPending, submit } = useSettingsSave(settings);
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
