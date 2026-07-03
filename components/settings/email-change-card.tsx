'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  requestCurrentEmailChangeOtp,
  resetEmailChangeWizard,
  savePendingNewEmailVerification,
  touchPendingNewEmailVerification,
  verifyCurrentEmailChangeOtp,
  verifyNewEmailChangeOtp,
} from '@/lib/settings/email-change-actions';
import {
  type EmailChangeActionError,
  type EmailChangeActionResult,
  type EmailChangeWizardState,
} from '@/lib/settings/email-change.types';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useSettingsBanner } from '@/components/settings/settings-banner-provider';
import { useUserProfile } from '@/components/user/user-profile-context';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';

const newEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Bitte gib eine gültige E-Mail-Adresse ein.'),
});

type NewEmailValues = z.infer<typeof newEmailSchema>;

type CompletionState = {
  previousEmail: string;
  newEmail: string;
};

type EmailChangeCardProps = {
  initialState: EmailChangeWizardState;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function formatRemainingTime(targetIso: string | null, now: number) {
  if (!targetIso) {
    return null;
  }

  const diffMs = new Date(targetIso).getTime() - now;
  if (diffMs <= 0) {
    return '00:00';
  }

  const totalSeconds = Math.ceil(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function isExpired(targetIso: string | null, now: number) {
  if (!targetIso) {
    return false;
  }

  return new Date(targetIso).getTime() <= now;
}

function translateActionError(error?: EmailChangeActionError) {
  switch (error) {
    case 'cooldown':
      return 'Bitte warte kurz, bevor du einen neuen Code anforderst.';
    case 'challenge_not_found':
      return 'Der Änderungsprozess ist nicht mehr aktiv. Bitte starte ihn erneut.';
    case 'challenge_expired':
      return 'Der Code ist abgelaufen. Bitte starte die Änderung erneut.';
    case 'too_many_attempts':
      return 'Zu viele falsche Versuche. Bitte fordere einen neuen Code an.';
    case 'invalid_code':
      return 'Der eingegebene Code ist ungültig.';
    case 'current_email_not_verified':
      return 'Bestätige zuerst deine aktuelle E-Mail-Adresse.';
    case 'verification_window_expired':
      return 'Die Zeit zum Eingeben deiner neuen E-Mail-Adresse ist abgelaufen. Bitte starte den Flow erneut.';
    case 'invalid_email':
      return 'Bitte gib eine gültige, neue E-Mail-Adresse ein.';
    case 'email_send_failed':
      return 'Der Bestätigungscode konnte gerade nicht gesendet werden. Bitte versuche es erneut.';
    case 'new_email_code_expired':
      return 'Der Code für die neue E-Mail-Adresse ist abgelaufen. Bitte fordere einen neuen Code an.';
    case 'new_email_invalid_code':
      return 'Der Code für die neue E-Mail-Adresse ist ungültig.';
    case 'new_email_too_many_attempts':
      return 'Zu viele falsche Versuche für die neue E-Mail-Adresse. Bitte sende einen neuen Code.';
    case 'not_authenticated':
      return 'Du bist nicht mehr angemeldet. Bitte lade die Seite neu.';
    case 'no_active_email':
      return 'Für dieses Konto ist aktuell keine bestätigte E-Mail-Adresse verfügbar.';
    default:
      return 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut.';
  }
}

function applyResultError(
  result: EmailChangeActionResult,
  setState: (state: EmailChangeWizardState) => void,
  setError: (error: string | null) => void
) {
  setState(result.state);
  setError(result.success ? null : translateActionError(result.error));
}

function StepIndicator({
  currentStep,
  isComplete,
}: {
  currentStep: EmailChangeWizardState['step'];
  isComplete: boolean;
}) {
  const steps = [
    {
      key: 'verify_current',
      label: 'Aktuelle E-Mail bestätigen',
      description: 'Code an die aktuelle Adresse',
    },
    {
      key: 'enter_new',
      label: 'Neue E-Mail eingeben',
      description: 'Neue Adresse für das Konto',
    },
    {
      key: 'verify_new',
      label: 'Neue E-Mail bestätigen',
      description: 'Code aus dem neuen Postfach',
    },
  ] as const;

  return (
    <div className="flex gap-4 lg:w-52 lg:flex-col">
      {steps.map((step, index) => {
        const isActive = !isComplete && currentStep === step.key;
        const isStepComplete =
          isComplete ||
          (step.key === 'verify_current' &&
            (currentStep === 'enter_new' || currentStep === 'verify_new')) ||
          (step.key === 'enter_new' && currentStep === 'verify_new');

        return (
          <div
            key={step.key}
            className="flex flex-1 items-start gap-3 lg:flex-none"
          >
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  isStepComplete
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground'
                )}
              >
                {isStepComplete ? <CheckCircle2 className="size-4" /> : index + 1}
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={cn(
                    'mt-2 h-10 w-px rounded-full lg:h-12',
                    isStepComplete ? 'bg-primary/60' : 'bg-border'
                  )}
                />
              ) : null}
            </div>
            <div className="pt-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  isActive || isStepComplete
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OtpCodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputOTP
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

export function EmailChangeCard({ initialState }: EmailChangeCardProps) {
  const router = useRouter();
  const { profile, refreshProfile } = useUserProfile();
  const { showBanner } = useSettingsBanner();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [wizardState, setWizardState] = useState(initialState);
  const [completionState, setCompletionState] = useState<CompletionState | null>(
    null
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [currentOtpCode, setCurrentOtpCode] = useState('');
  const [newEmailOtpCode, setNewEmailOtpCode] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isCurrentOtpSubmitting, setIsCurrentOtpSubmitting] = useState(false);
  const [isCurrentOtpResending, setIsCurrentOtpResending] = useState(false);
  const [isSavingNewEmail, setIsSavingNewEmail] = useState(false);
  const [isNewEmailOtpSubmitting, setIsNewEmailOtpSubmitting] = useState(false);
  const [isNewEmailOtpResending, setIsNewEmailOtpResending] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const emailForm = useForm<NewEmailValues>({
    resolver: zodResolver(newEmailSchema),
    defaultValues: {
      email: initialState.newEmail ?? '',
    },
  });

  useEffect(() => {
    setWizardState(initialState);
  }, [initialState]);

  useEffect(() => {
    emailForm.reset({
      email: initialState.newEmail ?? '',
    });
  }, [emailForm, initialState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const currentEmail = profile?.email ?? wizardState.currentEmail ?? '';
  const pendingNewEmail = wizardState.newEmail;
  const currentOtpResendLocked = !isExpired(
    wizardState.currentOtpResendAvailableAt,
    now
  );
  const newEmailResendLocked = !isExpired(
    wizardState.newEmailResendAvailableAt,
    now
  );
  const currentOtpCountdown = formatRemainingTime(
    wizardState.currentOtpResendAvailableAt,
    now
  );
  const newEmailResendCountdown = formatRemainingTime(
    wizardState.newEmailResendAvailableAt,
    now
  );
  const currentOtpExpiryCountdown = formatRemainingTime(
    wizardState.currentOtpExpiresAt,
    now
  );
  const currentEmailVerificationWindowCountdown = formatRemainingTime(
    wizardState.currentEmailVerifiedExpiresAt,
    now
  );
  const newEmailOtpExpiryCountdown = formatRemainingTime(
    wizardState.newEmailOtpExpiresAt,
    now
  );
  const currentEmailVerificationWindowExpired = isExpired(
    wizardState.currentEmailVerifiedExpiresAt,
    now
  );

  async function handleStartFlow() {
    setFormError(null);
    setCompletionState(null);
    setCurrentOtpCode('');
    setIsStarting(true);

    try {
      const result = await requestCurrentEmailChangeOtp();
      applyResultError(result, setWizardState, setFormError);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleVerifyCurrentEmailCode() {
    setFormError(null);

    if (currentOtpCode.replace(/\D/g, '').length !== 6) {
      setFormError('Bitte gib den vollständigen sechsstelligen Code ein.');
      return;
    }

    setIsCurrentOtpSubmitting(true);

    try {
      const result = await verifyCurrentEmailChangeOtp(currentOtpCode);
      applyResultError(result, setWizardState, setFormError);

      if (result.success) {
        setCurrentOtpCode('');
      }
    } finally {
      setIsCurrentOtpSubmitting(false);
    }
  }

  async function handleResendCurrentEmailCode() {
    setFormError(null);
    setIsCurrentOtpResending(true);

    try {
      const result = await requestCurrentEmailChangeOtp();
      applyResultError(result, setWizardState, setFormError);
    } finally {
      setIsCurrentOtpResending(false);
    }
  }

  const handleSubmitNewEmail = emailForm.handleSubmit(async (values) => {
    const nextEmail = normalizeEmail(values.email);
    const activeEmail = normalizeEmail(currentEmail);

    if (nextEmail === activeEmail) {
      emailForm.setError('email', {
        type: 'manual',
        message:
          'Bitte gib eine andere E-Mail-Adresse ein als die aktuell hinterlegte.',
      });
      return;
    }

    setFormError(null);
    setIsSavingNewEmail(true);

    try {
      const result = await savePendingNewEmailVerification(nextEmail);
      applyResultError(result, setWizardState, setFormError);

      if (result.success) {
        emailForm.reset({ email: nextEmail });
      }
    } finally {
      setIsSavingNewEmail(false);
    }
  });

  async function handleResendNewEmailCode() {
    if (!pendingNewEmail) {
      return;
    }

    setFormError(null);
    setIsNewEmailOtpResending(true);

    try {
      const result = await touchPendingNewEmailVerification(pendingNewEmail);
      applyResultError(result, setWizardState, setFormError);
    } finally {
      setIsNewEmailOtpResending(false);
    }
  }

  async function handleVerifyNewEmailCode() {
    if (!pendingNewEmail) {
      setFormError('Es ist keine neue E-Mail-Adresse zum Bestätigen vorhanden.');
      return;
    }

    const sanitizedCode = newEmailOtpCode.replace(/\D/g, '');
    if (sanitizedCode.length !== 6) {
      setFormError('Bitte gib den vollständigen sechsstelligen Code ein.');
      return;
    }

    setFormError(null);
    setIsNewEmailOtpSubmitting(true);

    try {
      const previousEmail = currentEmail;
      const result = await verifyNewEmailChangeOtp(sanitizedCode);
      applyResultError(result, setWizardState, setFormError);

      if (!result.success) {
        return;
      }

      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        setFormError(
          'Die E-Mail-Adresse wurde aktualisiert, aber die Sitzung konnte nicht sofort aktualisiert werden. Bitte lade die Seite neu.'
        );
      }

      if (data.session) {
        await fetch('/auth/callback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event: 'TOKEN_REFRESHED',
            session: data.session,
          }),
        });
      }
      await refreshProfile();
      router.refresh();
      setCompletionState({
        previousEmail,
        newEmail: pendingNewEmail,
      });
      setCurrentOtpCode('');
      setNewEmailOtpCode('');
      showBanner({
        message: 'Deine E-Mail-Adresse wurde erfolgreich aktualisiert.',
        variant: 'success',
      });
    } finally {
      setIsNewEmailOtpSubmitting(false);
    }
  }

  async function handleResetFlow() {
    setFormError(null);
    setIsResetting(true);

    try {
      const result = await resetEmailChangeWizard();
      applyResultError(result, setWizardState, setFormError);

      if (result.success) {
        setCurrentOtpCode('');
        setNewEmailOtpCode('');
        emailForm.reset({ email: '' });
      }
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-Mail-Adresse</CardTitle>
        <CardDescription>
          Verifiziere zuerst deine aktuelle Adresse, hinterlege danach die neue
          E-Mail-Adresse und bestätige sie mit einem zweiten Code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {completionState ? (
          <div className="rounded-lg border bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <CheckCircle2 className="size-5" />
              </div>
              <div className="space-y-3">
                <div>
                  <p className="font-medium text-foreground">
                    E-Mail-Adresse erfolgreich aktualisiert
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Dein Konto verwendet jetzt die neue Adresse zum Login.
                  </p>
                </div>
                <div className="rounded-lg border bg-background p-3 text-sm">
                  <p className="text-muted-foreground">
                    Bisherige Adresse:{' '}
                    <span className="font-medium text-foreground">
                      {completionState.previousEmail}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Neue Adresse:{' '}
                    <span className="font-medium text-foreground">
                      {completionState.newEmail}
                    </span>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCompletionState(null)}
                >
                  Fertig
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm font-medium text-foreground">
            Aktuelle E-Mail-Adresse
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <Mail className="size-4" />
              </div>
              <div>
                <p className="font-medium text-foreground">{currentEmail || '—'}</p>
                <p className="text-sm text-muted-foreground">
                  Diese Adresse ist aktuell mit deinem Konto verknüpft.
                </p>
              </div>
            </div>
            {wizardState.step === 'idle' ? (
              <Button
                type="button"
                onClick={handleStartFlow}
                disabled={isStarting || !currentEmail}
              >
                {isStarting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Startet...
                  </>
                ) : (
                  'E-Mail-Adresse ändern'
                )}
              </Button>
            ) : null}
          </div>
        </div>

        {wizardState.step !== 'idle' ? (
          <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <StepIndicator
              currentStep={wizardState.step}
              isComplete={completionState !== null}
            />

            <div className="space-y-5 rounded-lg border bg-background p-5">
              {formError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {formError}
                </div>
              ) : null}

              {wizardState.step === 'verify_current' ? (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleVerifyCurrentEmailCode();
                  }}
                >
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-foreground">
                      Schritt 1: Aktuelle E-Mail bestätigen
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Wir haben einen sechsstelligen Code an{' '}
                      <span className="font-medium text-foreground">
                        {currentEmail}
                      </span>{' '}
                      gesendet. Gib ihn hier ein, um den Änderungsprozess zu
                      starten.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <OtpCodeInput
                      value={currentOtpCode}
                      onChange={setCurrentOtpCode}
                    />
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span>
                        Code gültig für {currentOtpExpiryCountdown ?? '00:00'}
                      </span>
                      <button
                        type="button"
                        onClick={handleResendCurrentEmailCode}
                        disabled={isCurrentOtpResending || currentOtpResendLocked}
                        className="text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
                      >
                        {isCurrentOtpResending
                          ? 'Code wird erneut gesendet...'
                          : currentOtpResendLocked
                            ? `Erneut senden in ${currentOtpCountdown}`
                            : 'Code erneut senden'}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleResetFlow}
                      disabled={isResetting}
                    >
                      {isResetting ? 'Bricht ab...' : 'Abbrechen'}
                    </Button>
                    <Button
                      type="submit"
                      disabled={isCurrentOtpSubmitting}
                    >
                      {isCurrentOtpSubmitting ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Code wird geprüft...
                        </>
                      ) : (
                        'Code bestätigen'
                      )}
                    </Button>
                  </div>
                </form>
              ) : null}

              {wizardState.step === 'enter_new' ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-foreground">
                      <ShieldCheck className="size-4 text-primary" />
                      <p className="text-base font-semibold">
                        Schritt 2: Neue E-Mail-Adresse eingeben
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Deine aktuelle Adresse wurde bestätigt. Hinterlege jetzt die
                      neue E-Mail-Adresse. Das Zeitfenster bleibt noch{' '}
                      <span className="font-medium text-foreground">
                        {currentEmailVerificationWindowCountdown ?? '00:00'}
                      </span>{' '}
                      aktiv.
                    </p>
                  </div>

                  {currentEmailVerificationWindowExpired ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      Das Zeitfenster für diesen Schritt ist abgelaufen. Bitte
                      starte den Änderungsprozess erneut.
                    </div>
                  ) : (
                    <Form {...emailForm}>
                      <form
                        onSubmit={handleSubmitNewEmail}
                        className="space-y-4"
                      >
                        <FormField
                          control={emailForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Neue E-Mail-Adresse</FormLabel>
                              <FormControl>
                                <Input
                                  type="email"
                                  autoComplete="email"
                                  placeholder="beispiel@firma.de"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleResetFlow}
                            disabled={isResetting}
                          >
                            {isResetting ? 'Bricht ab...' : 'Abbrechen'}
                          </Button>
                          <Button type="submit" disabled={isSavingNewEmail}>
                            {isSavingNewEmail ? (
                              <>
                                <Loader2 className="mr-2 size-4 animate-spin" />
                                Neue Adresse wird vorbereitet...
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
              ) : null}

              {wizardState.step === 'verify_new' ? (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleVerifyNewEmailCode();
                  }}
                >
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-foreground">
                      Schritt 3: Neue E-Mail-Adresse bestätigen
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Wir haben einen sechsstelligen Code an{' '}
                      <span className="font-medium text-foreground">
                        {pendingNewEmail}
                      </span>{' '}
                      gesendet. Erst nach dieser Bestätigung wird die Adresse für
                      dein Konto übernommen.
                    </p>
                  </div>

                  <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                    <p className="font-medium text-foreground">Verlauf</p>
                    <p className="mt-1 text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {currentEmail}
                      </span>{' '}
                      wird nach erfolgreicher Bestätigung zu{' '}
                      <span className="font-medium text-foreground">
                        {pendingNewEmail}
                      </span>
                      .
                    </p>
                  </div>

                  <div className="space-y-3">
                    <OtpCodeInput
                      value={newEmailOtpCode}
                      onChange={setNewEmailOtpCode}
                    />
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <button
                        type="button"
                        onClick={handleResendNewEmailCode}
                        disabled={isNewEmailOtpResending || newEmailResendLocked}
                        className="text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
                      >
                        {isNewEmailOtpResending
                          ? 'Code wird erneut gesendet...'
                          : newEmailResendLocked
                            ? `Erneut senden in ${newEmailResendCountdown}`
                            : 'Code erneut senden'}
                      </button>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      Code gültig für {newEmailOtpExpiryCountdown ?? '00:00'}
                    </span>
                  </div>

                  <Button
                    type="submit"
                    disabled={isNewEmailOtpSubmitting}
                  >
                    {isNewEmailOtpSubmitting ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Neue Adresse wird bestätigt...
                      </>
                    ) : (
                      'Neue E-Mail-Adresse bestätigen'
                    )}
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
