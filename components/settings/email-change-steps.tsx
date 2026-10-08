'use client';

import { ArrowRight, ShieldCheck } from 'lucide-react';

import { type EmailChangeWizard } from '@/components/settings/use-email-change-wizard';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { PlainButton } from '@/components/ui/plain-button';
import { Spinner } from '@/components/ui/spinner';

function OtpCodeInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputOTP
      id={id}
      value={value}
      onChange={onChange}
      maxLength={6}
      pattern="[0-9]*"
      className="font-mono text-base"
      containerClassName="justify-start"
    >
      <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:size-12 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  );
}

export function VerifyCurrentEmailStep({ wizard }: { wizard: EmailChangeWizard }) {
  const {
    currentEmail,
    currentOtpCode,
    setCurrentOtpCode,
    isResetting,
    isCurrentOtpSubmitting,
    isCurrentOtpResending,
    handleVerifyCurrentEmailCode,
    handleResendCurrentEmailCode,
    handleResetFlow,
  } = wizard;
  const { currentOtpExpiryCountdown, currentOtpResendLocked, currentOtpCountdown } = wizard.timers;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleVerifyCurrentEmailCode();
      }}
    >
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">Schritt 1: Aktuelle E-Mail bestätigen</p>
        <p className="text-sm text-muted-foreground">
          Wir haben einen sechsstelligen Code an{' '}
          <span className="font-medium text-foreground">{currentEmail}</span> gesendet. Gib ihn hier ein, um
          den Änderungsprozess zu starten.
        </p>
      </div>

      <div className="space-y-3">
        <Field label="Bestätigungscode" htmlFor="current-email-otp" required>
          <OtpCodeInput id="current-email-otp" value={currentOtpCode} onChange={setCurrentOtpCode} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>Code gültig für {currentOtpExpiryCountdown ?? '00:00'}</span>
          <PlainButton
            type="button"
            onClick={handleResendCurrentEmailCode}
            disabled={isResetting || isCurrentOtpResending || currentOtpResendLocked}
            className="text-primary-text underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {isCurrentOtpResending
              ? 'Code wird erneut gesendet…'
              : currentOtpResendLocked
                ? `Erneut senden in ${currentOtpCountdown}`
                : 'Code erneut senden'}
          </PlainButton>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={handleResetFlow}
          disabled={isResetting || isCurrentOtpSubmitting || isCurrentOtpResending}
        >
          {isResetting ? (
            <>
              <Spinner className="mr-2" />
              Wird abgebrochen…
            </>
          ) : (
            'E-Mail-Änderung abbrechen'
          )}
        </Button>
        <Button type="submit" disabled={isCurrentOtpSubmitting || isResetting}>
          {isCurrentOtpSubmitting ? (
            <>
              <Spinner className="mr-2" />
              Code wird geprüft…
            </>
          ) : (
            'Code bestätigen'
          )}
        </Button>
      </div>
    </form>
  );
}

export function EnterNewEmailStep({ wizard }: { wizard: EmailChangeWizard }) {
  const { emailForm, isResetting, isSavingNewEmail, handleSubmitNewEmail, handleResetFlow } = wizard;
  const { currentEmailVerificationWindowCountdown, currentEmailVerificationWindowExpired } = wizard.timers;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="size-4 text-primary" />
          <p className="text-base font-semibold">Schritt 2: Neue E-Mail-Adresse eingeben</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Deine aktuelle Adresse wurde bestätigt. Hinterlege jetzt die neue E-Mail-Adresse. Das Zeitfenster
          bleibt noch{' '}
          <span className="font-medium text-foreground">
            {currentEmailVerificationWindowCountdown ?? '00:00'}
          </span>{' '}
          aktiv.
        </p>
      </div>

      {currentEmailVerificationWindowExpired ? (
        <div className="space-y-4">
          <ErrorText>
            Das Zeitfenster für diesen Schritt ist abgelaufen. Bitte brich die E-Mail-Änderung ab und starte
            sie erneut.
          </ErrorText>
          <Button type="button" variant="outline" onClick={handleResetFlow} disabled={isResetting}>
            {isResetting ? (
              <>
                <Spinner className="mr-2" />
                Wird abgebrochen…
              </>
            ) : (
              'E-Mail-Änderung abbrechen'
            )}
          </Button>
        </div>
      ) : (
        <Form {...emailForm}>
          <form onSubmit={handleSubmitNewEmail} className="space-y-4">
            <FormField
              control={emailForm.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field label="Neue E-Mail-Adresse" required error={fieldState.error?.message}>
                  <Input type="email" autoComplete="email" placeholder="beispiel@firma.de" {...field} />
                </Field>
              )}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={handleResetFlow}
                disabled={isResetting || isSavingNewEmail}
              >
                {isResetting ? (
                  <>
                    <Spinner className="mr-2" />
                    Wird abgebrochen…
                  </>
                ) : (
                  'E-Mail-Änderung abbrechen'
                )}
              </Button>
              <Button type="submit" disabled={isSavingNewEmail || isResetting}>
                {isSavingNewEmail ? (
                  <>
                    <Spinner className="mr-2" />
                    Neue Adresse wird vorbereitet…
                  </>
                ) : (
                  <>
                    Weiter zur Bestätigung
                    <ArrowRight className="ml-2 size-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}

export function VerifyNewEmailStep({ wizard }: { wizard: EmailChangeWizard }) {
  const {
    currentEmail,
    pendingNewEmail,
    newEmailOtpCode,
    setNewEmailOtpCode,
    isResetting,
    isNewEmailOtpSubmitting,
    isNewEmailOtpResending,
    handleVerifyNewEmailCode,
    handleResendNewEmailCode,
    handleResetFlow,
  } = wizard;
  const { newEmailOtpExpiryCountdown, newEmailResendLocked, newEmailResendCountdown } = wizard.timers;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleVerifyNewEmailCode();
      }}
    >
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">Schritt 3: Neue E-Mail-Adresse bestätigen</p>
        <p className="text-sm text-muted-foreground">
          Wir haben einen sechsstelligen Code an{' '}
          <span className="font-medium text-foreground">{pendingNewEmail}</span> gesendet. Erst nach dieser
          Bestätigung wird die Adresse für dein Konto übernommen.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <p className="font-medium text-foreground">Verlauf</p>
        <p className="mt-1 text-muted-foreground">
          <span className="font-medium text-foreground">{currentEmail}</span> wird nach erfolgreicher
          Bestätigung zu <span className="font-medium text-foreground">{pendingNewEmail}</span>.
        </p>
      </div>

      <div className="space-y-3">
        <Field label="Bestätigungscode" htmlFor="new-email-otp" required>
          <OtpCodeInput id="new-email-otp" value={newEmailOtpCode} onChange={setNewEmailOtpCode} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <PlainButton
            type="button"
            onClick={handleResendNewEmailCode}
            disabled={isResetting || isNewEmailOtpResending || newEmailResendLocked}
            className="text-primary-text underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {isNewEmailOtpResending
              ? 'Code wird erneut gesendet…'
              : newEmailResendLocked
                ? `Erneut senden in ${newEmailResendCountdown}`
                : 'Code erneut senden'}
          </PlainButton>
        </div>
        <span className="text-sm text-muted-foreground">
          Code gültig für {newEmailOtpExpiryCountdown ?? '00:00'}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={handleResetFlow}
          disabled={isResetting || isNewEmailOtpSubmitting || isNewEmailOtpResending}
        >
          {isResetting ? (
            <>
              <Spinner className="mr-2" />
              Wird abgebrochen…
            </>
          ) : (
            'E-Mail-Änderung abbrechen'
          )}
        </Button>
        <Button type="submit" disabled={isNewEmailOtpSubmitting || isResetting}>
          {isNewEmailOtpSubmitting ? (
            <>
              <Spinner className="mr-2" />
              Neue Adresse wird bestätigt…
            </>
          ) : (
            'Neue E-Mail-Adresse bestätigen'
          )}
        </Button>
      </div>
    </form>
  );
}
