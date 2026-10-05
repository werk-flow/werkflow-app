'use client';

import { KeyRound, ShieldCheck } from 'lucide-react';

import { NewPasswordFieldsForm } from '@/components/password/new-password-fields-form';
import { PasswordStepIndicator } from '@/components/settings/password-step-indicator';
import { usePasswordChangeFlow } from '@/components/settings/use-password-change-flow';
import { VerifyCurrentPasswordStep } from '@/components/settings/verify-current-password-step';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';

export function PasswordChangeCard() {
  const {
    step,
    formError,
    emailUnavailable,
    retryEmailRead,
    isCurrentPasswordSubmitting,
    isForgotPasswordRedirecting,
    isPasswordSubmitting,
    currentPasswordForm,
    startFlow,
    resetFlow,
    backToVerificationStep,
    onCurrentPasswordSubmit,
    onPasswordSubmit,
    handleForgotPassword,
  } = usePasswordChangeFlow();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passwort</CardTitle>
        <CardDescription>
          Bestätige zuerst dein aktuelles Passwort und hinterlege danach ein neues. Wenn du dein aktuelles
          Passwort nicht mehr kennst, kannst du den bestehenden Zurücksetzen-Flow verwenden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm font-medium text-foreground">Sicherheit</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <KeyRound className="size-4" />
              </div>
              <div>
                <p className="font-medium text-foreground">Passwort aktualisieren</p>
                <p className="text-sm text-muted-foreground">
                  Ändere dein Passwort und halte andere Sitzungen aktuell.
                </p>
              </div>
            </div>
            {step === 'idle' ? (
              <Button type="button" onClick={startFlow}>
                Passwort ändern
              </Button>
            ) : null}
          </div>
        </div>

        {step !== 'idle' ? (
          <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <PasswordStepIndicator currentStep={step} />

            <div className="space-y-5 rounded-lg border bg-background p-5">
              {emailUnavailable ? (
                <SectionError onRetry={retryEmailRead}>
                  Deine E-Mail-Adresse konnte nicht geladen werden.
                </SectionError>
              ) : null}
              <ErrorText>{formError}</ErrorText>

              {step === 'verify_current' ? (
                <VerifyCurrentPasswordStep
                  currentPasswordForm={currentPasswordForm}
                  isCurrentPasswordSubmitting={isCurrentPasswordSubmitting}
                  isForgotPasswordRedirecting={isForgotPasswordRedirecting}
                  onCurrentPasswordSubmit={onCurrentPasswordSubmit}
                  handleForgotPassword={handleForgotPassword}
                  resetFlow={resetFlow}
                />
              ) : null}

              {step === 'set_new' ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-foreground">
                      <ShieldCheck className="size-4 text-primary" />
                      <p className="text-base font-semibold">Schritt 2: Neues Passwort festlegen</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Hinterlege jetzt dein neues Passwort und bestätige es zur Sicherheit ein zweites Mal.
                    </p>
                  </div>

                  <NewPasswordFieldsForm
                    formError={formError}
                    isSubmitting={isPasswordSubmitting}
                    submitLabel="Passwort aktualisieren"
                    submittingLabel="Passwort wird aktualisiert…"
                    onSubmit={onPasswordSubmit}
                    onBack={backToVerificationStep}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
