'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { type UseFormReturn } from 'react-hook-form';

import { type CurrentPasswordValues } from '@/components/settings/use-password-change-flow';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { PasswordInput } from '@/components/ui/password-input';

type VerifyCurrentPasswordStepProps = {
  currentPasswordForm: UseFormReturn<CurrentPasswordValues>;
  isCurrentPasswordSubmitting: boolean;
  isForgotPasswordRedirecting: boolean;
  onCurrentPasswordSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
  handleForgotPassword: () => Promise<void>;
  resetFlow: () => void;
};

export function VerifyCurrentPasswordStep({
  currentPasswordForm,
  isCurrentPasswordSubmitting,
  isForgotPasswordRedirecting,
  onCurrentPasswordSubmit,
  handleForgotPassword,
  resetFlow,
}: VerifyCurrentPasswordStepProps) {
  return (
    <Form {...currentPasswordForm}>
      <form className="space-y-4" onSubmit={onCurrentPasswordSubmit}>
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">Schritt 1: Aktuelles Passwort eingeben</p>
          <p className="text-sm text-muted-foreground">
            Gib zuerst dein aktuelles Passwort ein. Wenn du es nicht mehr weißt, kannst du den normalen
            Zurücksetzen-Flow verwenden.
          </p>
        </div>

        <FormField
          control={currentPasswordForm.control}
          name="currentPassword"
          render={({ field, fieldState }) => (
            <Field label="Aktuelles Passwort" required error={fieldState.error?.message}>
              <PasswordInput placeholder="Aktuelles Passwort" autoComplete="current-password" {...field} />
            </Field>
          )}
        />

        <p className="text-sm text-muted-foreground">
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 py-0"
            onClick={handleForgotPassword}
            disabled={isCurrentPasswordSubmitting || isForgotPasswordRedirecting}
          >
            {isForgotPasswordRedirecting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Weiterleitung…
              </>
            ) : (
              'Passwort vergessen?'
            )}
          </Button>{' '}
          Wenn du dein aktuelles Passwort nicht mehr kennst, melden wir dich ab. Danach kannst du dir per
          E-Mail einen Link senden lassen und dein Passwort darüber zurücksetzen.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={resetFlow}
            disabled={isCurrentPasswordSubmitting || isForgotPasswordRedirecting}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={isCurrentPasswordSubmitting || isForgotPasswordRedirecting}>
            {isCurrentPasswordSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Wird geprüft…
              </>
            ) : (
              <>
                Weiter
                <ArrowRight className="ml-2 size-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
