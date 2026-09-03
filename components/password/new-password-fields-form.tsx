'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { PasswordInput } from '@/components/ui/password-input';
import {
  getPasswordConfirmationError,
  getPasswordRequirements,
  getPasswordStrengthLevel,
  passwordWithConfirmationSchema,
  type PasswordWithConfirmationValues,
} from '@/lib/validation/password';

import { PasswordRequirements } from './PasswordRequirements';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';

type NewPasswordFieldsFormProps = {
  formError?: string | null;
  isSubmitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: PasswordWithConfirmationValues) => Promise<void> | void;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
};

export function NewPasswordFieldsForm({
  formError,
  isSubmitting,
  submitLabel,
  submittingLabel,
  onSubmit,
  onBack,
  backLabel = 'Zurück',
  className = 'grid gap-4',
}: NewPasswordFieldsFormProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const form = useForm<PasswordWithConfirmationValues>({
    resolver: zodResolver(passwordWithConfirmationSchema),
    mode: 'onChange',
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  const passwordValue =
    useWatch({
      control: form.control,
      name: 'password',
    }) ?? '';
  const requirements = useMemo(
    () => getPasswordRequirements(passwordValue),
    [passwordValue]
  );
  const strengthLevel = useMemo(
    () => getPasswordStrengthLevel(passwordValue),
    [passwordValue]
  );
  const displayError = validationError ?? formError ?? null;

  function clearValidationError() {
    if (validationError) {
      setValidationError(null);
    }
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    setValidationError(null);

    const confirmationError = getPasswordConfirmationError(values);
    if (confirmationError) {
      setValidationError(confirmationError);
      return;
    }

    await onSubmit(values);
  });

  return (
    <Form {...form}>
      <form className={className} onSubmit={handleSubmit}>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <Field label="Neues Passwort" required>
              <PasswordInput
                {...field}
                autoComplete="new-password"
                placeholder="Neues Passwort"
                onChange={(event) => {
                  clearValidationError();
                  field.onChange(event);
                }}
              />
              <PasswordStrengthMeter className="mt-2" level={strengthLevel} />
              <PasswordRequirements className="mt-2" requirements={requirements} />
            </Field>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field, fieldState }) => (
            <Field
              label="Passwort bestätigen"
              required
              error={fieldState.error?.message}
            >
              <PasswordInput
                {...field}
                autoComplete="new-password"
                placeholder="Passwort wiederholen"
                onChange={(event) => {
                  clearValidationError();
                  field.onChange(event);
                }}
              />
            </Field>
          )}
        />

        <ErrorText>{displayError}</ErrorText>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          {onBack ? (
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={isSubmitting}
            >
              {backLabel}
            </Button>
          ) : null}
          <Button
            className={onBack ? undefined : 'w-full'}
            type="submit"
            disabled={isSubmitting || !requirements.allMet}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {submittingLabel}
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
