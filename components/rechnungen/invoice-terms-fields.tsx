'use client';

import { SectionTitle } from '@/components/shared/section-title';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TERM_FIELD_IDS, type DraftForm } from '@/lib/invoices/draft-form';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';

type Props = {
  form: DraftForm;
  onChange: (form: DraftForm) => void;
  errors: Record<string, string | undefined>;
  disabled: boolean;
};

/** Leistungsdatum or -zeitraum, Zahlungsziel and Skonto, the buyer's references. */
export function InvoiceTermsFields(props: Props) {
  return (
    <section className="space-y-4">
      <SectionTitle as="h2">Leistung und Zahlung</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <ServicePeriodFields {...props} />
        <PaymentFields {...props} />
        <ReferenceFields {...props} />
      </div>
    </section>
  );
}

function ServicePeriodFields({ form, onChange, errors, disabled }: Props) {
  // The picker answers the chosen day as the browser's local midnight: keep that calendar day.
  const day = (value: Date | undefined) => (value ? toLocalDateString(value) : '');
  return (
    <>
      <Field
        label="Leistungsdatum"
        htmlFor={TERM_FIELD_IDS.serviceStart}
        description="Bei einem Zeitraum der erste Tag."
        error={errors[TERM_FIELD_IDS.serviceStart]}
      >
        <DatePicker
          id={TERM_FIELD_IDS.serviceStart}
          ariaLabel="Leistungsdatum"
          value={parseIsoLocalDate(form.serviceStart)}
          onChange={(value) => onChange({ ...form, serviceStart: day(value) })}
          disabled={disabled}
        />
      </Field>
      <Field
        label="Leistung bis"
        htmlFor={TERM_FIELD_IDS.serviceEnd}
        description="Nur bei einem Leistungszeitraum."
        error={errors[TERM_FIELD_IDS.serviceEnd]}
      >
        <DatePicker
          id={TERM_FIELD_IDS.serviceEnd}
          ariaLabel="Leistung bis"
          value={parseIsoLocalDate(form.serviceEnd)}
          onChange={(value) => onChange({ ...form, serviceEnd: day(value) })}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

function PaymentFields({ form, onChange, errors, disabled }: Props) {
  return (
    <>
      <Field
        label="Zahlungsziel in Tagen"
        htmlFor={TERM_FIELD_IDS.paymentDueDays}
        required
        error={errors[TERM_FIELD_IDS.paymentDueDays]}
      >
        <Input
          inputMode="numeric"
          autoComplete="off"
          value={form.paymentDueDays}
          onChange={(event) => onChange({ ...form, paymentDueDays: event.target.value })}
          disabled={disabled}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Skonto in %"
          htmlFor={TERM_FIELD_IDS.discountPercent}
          error={errors[TERM_FIELD_IDS.discountPercent]}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={form.discountPercent}
            onChange={(event) => onChange({ ...form, discountPercent: event.target.value })}
            placeholder="Kein Skonto"
            disabled={disabled}
          />
        </Field>
        <Field
          label="innerhalb Tagen"
          htmlFor={TERM_FIELD_IDS.discountDays}
          error={errors[TERM_FIELD_IDS.discountDays]}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            value={form.discountDays}
            onChange={(event) => onChange({ ...form, discountDays: event.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>
    </>
  );
}

function ReferenceFields({ form, onChange, disabled }: Omit<Props, 'errors'>) {
  return (
    <>
      <Field label="Bestellnummer des Kunden" htmlFor="invoice-order-reference">
        <Input
          value={form.orderReference}
          onChange={(event) => onChange({ ...form, orderReference: event.target.value })}
          maxLength={200}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>
      <Field
        label="Referenz des Kunden"
        htmlFor="invoice-buyer-reference"
        description="Zum Beispiel Kostenstelle oder Leitweg-ID."
      >
        <Input
          value={form.buyerReference}
          onChange={(event) => onChange({ ...form, buyerReference: event.target.value })}
          maxLength={200}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>
    </>
  );
}

/** Opening and closing text of the invoice. */
export function InvoiceTextFields({ form, onChange, disabled }: Omit<Props, 'errors'>) {
  return (
    <section className="space-y-4">
      <SectionTitle as="h2">Texte</SectionTitle>
      <Field label="Einleitung" htmlFor="invoice-opening-text">
        <Textarea
          value={form.openingText}
          onChange={(event) => onChange({ ...form, openingText: event.target.value })}
          maxLength={4000}
          rows={3}
          disabled={disabled}
        />
      </Field>
      <Field label="Schlusstext" htmlFor="invoice-closing-text">
        <Textarea
          value={form.closingText}
          onChange={(event) => onChange({ ...form, closingText: event.target.value })}
          maxLength={4000}
          rows={3}
          disabled={disabled}
        />
      </Field>
    </section>
  );
}
