'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { z } from '@/lib/zod';

import { useSaveChangesSubmit } from '@/components/settings/use-save-changes-submit';
import { saveFailureBanner } from '@/lib/settings/save-answers';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { InlinePending } from '@/components/ui/inline-pending';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useServerAction } from '@/hooks/use-server-action';
import { updateTimeTrackingSettings } from '@/lib/time-tracking/settings-actions';
import {
  BREAK_MODE_OPTIONS,
  breakPolicyFormValues,
  timeTrackingSettingsSchema,
  type TimeTrackingSettingsValues,
} from '@/lib/time-tracking/break-rule-form';

const ERROR_MESSAGES = {
  org_not_found: 'Die aktive Organisation konnte nicht gefunden werden.',
  not_authorized: 'Nur Admins können diese Regeln ändern.',
  invalid_input: 'Bitte prüfe die Pausenregeln.',
  update_failed: 'Die Zeiterfassungsregeln konnten nicht gespeichert werden.',
} satisfies Record<string, string>;

type TimeTrackingSettingsFormProps = {
  initialSettings: TimeTrackingSettingsValues;
  role: 'admin' | 'buero' | 'employee';
};

type TimeTrackingSettingsFormInput = z.input<typeof timeTrackingSettingsSchema>;
type TimeTrackingSettingsFormOutput = z.output<typeof timeTrackingSettingsSchema>;

type TimeTrackingRulesForm = UseFormReturn<
  TimeTrackingSettingsFormInput,
  undefined,
  TimeTrackingSettingsFormOutput
>;

function TimeTrackingHeader({ isSaving }: { isSaving: boolean }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        Pausenregel
        <InlinePending active={isSaving} label="Zeiterfassungsregeln werden gespeichert" />
      </CardTitle>
      <CardDescription>
        Lege fest, ob Pausen weiter manuell gestempelt werden oder automatisch abgezogen werden.
      </CardDescription>
    </CardHeader>
  );
}

function BreakModeField({ form, disabled }: { form: TimeTrackingRulesForm; disabled: boolean }) {
  return (
    <FormField
      control={form.control}
      name="breakMode"
      render={({ field, fieldState }) => (
        <Field
          label="Art der Pausenbuchung"
          required
          description={
            BREAK_MODE_OPTIONS.find((option) => option.value === field.value)?.description ??
            BREAK_MODE_OPTIONS[0]?.description
          }
          error={fieldState.error?.message}
        >
          <Select disabled={disabled} onValueChange={field.onChange} value={field.value}>
            <SelectTrigger>
              <SelectValue placeholder="Bitte wählen" />
            </SelectTrigger>
            <SelectContent>
              {BREAK_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    />
  );
}

type MinutesFieldName =
  | 'autoBreakThresholdMinutes'
  | 'autoBreakDurationMinutes'
  | 'secondStepThresholdMinutes'
  | 'secondStepDurationMinutes';

function MinutesField({
  form,
  name,
  label,
  description,
  required = false,
  disabled,
}: {
  form: TimeTrackingRulesForm;
  name: MinutesFieldName;
  label: string;
  description: string;
  required?: boolean;
  disabled: boolean;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} required={required} description={description} error={fieldState.error?.message}>
          <Input
            name={field.name}
            ref={field.ref}
            type="text"
            inputMode="numeric"
            disabled={disabled}
            onBlur={field.onBlur}
            value={typeof field.value === 'number' ? field.value : ''}
            onChange={(event) => field.onChange(Number(event.target.value.replace(/[^0-9]/g, '') || 0))}
          />
        </Field>
      )}
    />
  );
}

function AutoBreakFields({ form, disabled }: { form: TimeTrackingRulesForm; disabled: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MinutesField
        form={form}
        name="autoBreakThresholdMinutes"
        label="Automatische Schwelle (Minuten)"
        required
        description="Ab dieser gesamten Anwesenheitszeit wird die automatische Pause berücksichtigt."
        disabled={disabled}
      />
      <MinutesField
        form={form}
        name="autoBreakDurationMinutes"
        label="Automatische Pausendauer (Minuten)"
        description="Diese Minuten werden automatisch abgezogen, sobald die Schwelle erreicht ist."
        disabled={disabled}
      />
    </div>
  );
}

function SecondStepFields({
  form,
  disabled,
  toggleDisabled,
  startsWithSave,
}: {
  form: TimeTrackingRulesForm;
  disabled: boolean;
  toggleDisabled: boolean;
  /** The step is off in the saved rule: switching it on starts with the save. */
  startsWithSave: boolean;
}) {
  const enabled = useWatch({ control: form.control, name: 'secondStepEnabled' });
  return (
    <fieldset className="space-y-4">
      <FormField
        control={form.control}
        name="secondStepEnabled"
        render={({ field }) => (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              ref={field.ref}
              checked={field.value}
              disabled={toggleDisabled}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
            <span className="font-medium">
              Zweite Stufe für lange Tage
              <span className="block font-normal text-muted-foreground">
                Ab der zweiten Schwelle gilt die längere Gesamtpause. Vorgabe nach ArbZG § 4: ab 9 Stunden
                insgesamt 45 Minuten.
                {startsWithSave ? ' Sie gilt ab dem Speichern, frühere Tage behalten ihre Pause.' : null}
              </span>
            </span>
          </label>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <MinutesField
          form={form}
          name="secondStepThresholdMinutes"
          label="Zweite Schwelle (Minuten)"
          description="Ab dieser gesamten Anwesenheitszeit gilt die längere Pause."
          disabled={disabled || !enabled}
        />
        <MinutesField
          form={form}
          name="secondStepDurationMinutes"
          label="Pause gesamt ab der zweiten Schwelle (Minuten)"
          description="Die gesamte Pause des Tages, nicht zusätzlich zur ersten Stufe."
          disabled={disabled || !enabled}
        />
      </div>
    </fieldset>
  );
}

function TimeTrackingSaveFooter({ canEdit, isSaving }: { canEdit: boolean; isSaving: boolean }) {
  return (
    <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {canEdit
          ? 'Neue Regeln gelten sofort für offene und kommende Zeiterfassungen. Bereits abgeschlossene Historie wird nicht rückwirkend umgeschrieben.'
          : 'Du kannst diese Regeln einsehen, aber nur der Admin kann sie ändern.'}
      </p>
      <Button type="submit" disabled={!canEdit || isSaving}>
        {isSaving ? 'Speichert…' : 'Zeiterfassung speichern'}
      </Button>
    </CardFooter>
  );
}

/**
 * Saved rules from new server props, such as another admin's save, remount
 * the form with them, so the first render shows them (adopted during render,
 * never in an effect).
 */
export function TimeTrackingSettingsForm(props: TimeTrackingSettingsFormProps) {
  return <TimeTrackingRulesCard key={JSON.stringify(props.initialSettings)} {...props} />;
}

function TimeTrackingRulesCard({ initialSettings, role }: TimeTrackingSettingsFormProps) {
  const { showBanner } = useBanner();
  const { run: runSave, isPending: isSaving } = useServerAction(updateTimeTrackingSettings);
  const canEdit = role === 'admin';
  const form = useForm<TimeTrackingSettingsFormInput, undefined, TimeTrackingSettingsFormOutput>({
    resolver: zodResolver(timeTrackingSettingsSchema),
    defaultValues: initialSettings,
  });

  const selectedBreakMode = useWatch({ control: form.control, name: 'breakMode' });

  const onSubmit = useSaveChangesSubmit(form, async (values) => {
    if (!canEdit) {
      return;
    }

    try {
      const result = await runSave(values);

      if (!result.success) {
        showBanner(saveFailureBanner(result.error, ERROR_MESSAGES, ERROR_MESSAGES.update_failed));
        return;
      }

      // The action's response renders the route with the saved rules.
      form.reset(breakPolicyFormValues(result.policy));
      showBanner({
        message: 'Die Regeln für die Zeiterfassung wurden gespeichert.',
        variant: 'success',
      });
    } catch {
      showBanner({ message: ERROR_MESSAGES.update_failed, variant: 'error' });
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <TimeTrackingHeader isSaving={isSaving} />
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-5 pb-8">
              <BreakModeField form={form} disabled={!canEdit || isSaving} />

              <AutoBreakFields
                form={form}
                disabled={!canEdit || isSaving || selectedBreakMode !== 'automatic'}
              />

              <SecondStepFields
                form={form}
                disabled={!canEdit || isSaving || selectedBreakMode !== 'automatic'}
                // The switch stays available in manual mode: an invalid second step can be switched off there.
                toggleDisabled={!canEdit || isSaving}
                startsWithSave={!initialSettings.secondStepEnabled}
              />

              <p className="text-sm text-muted-foreground">
                Die automatische Pause ist eine Rechenhilfe, kein Nachweis, dass die Pausen nach dem
                Arbeitszeitgesetz eingehalten wurden.
              </p>
            </CardContent>
            <TimeTrackingSaveFooter canEdit={canEdit} isSaving={isSaving} />
          </form>
        </Form>
      </Card>
    </div>
  );
}
