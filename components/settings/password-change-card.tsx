'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { NewPasswordFieldsForm } from '@/components/password/new-password-fields-form';
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
import { PasswordInput } from '@/components/ui/password-input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  type PasswordWithConfirmationValues,
  translateSupabasePasswordError,
} from '@/lib/validation/password';
import { createSupabaseTransientBrowserClient } from '@/lib/supabase/transient-client';

const currentPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Bitte gib dein aktuelles Passwort ein.'),
});
type CurrentPasswordValues = z.infer<typeof currentPasswordSchema>;
type PasswordChangeStep = 'idle' | 'verify_current' | 'set_new';

function isCurrentPasswordError(error: unknown) {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  const normalized = message.toLowerCase();

  if (
    normalized.includes('current password') ||
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid credentials') ||
    normalized.includes('incorrect password') ||
    normalized.includes('wrong password')
  ) {
    return true;
  }

  return false;
}

function PasswordStepIndicator({
  currentStep,
}: {
  currentStep: PasswordChangeStep;
}) {
  const steps = [
    {
      key: 'verify_current',
      label: 'Aktuelles Passwort',
      description: 'Zur Bestätigung deines Kontos',
    },
    {
      key: 'set_new',
      label: 'Neues Passwort',
      description: 'Sicheres Passwort festlegen',
    },
  ] as const;

  return (
    <div className="flex gap-4 lg:w-52 lg:flex-col">
      {steps.map((step, index) => {
        const isActive = currentStep === step.key;
        const isComplete =
          step.key === 'verify_current' && currentStep === 'set_new';

        return (
          <div key={step.key} className="flex flex-1 items-start gap-3 lg:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  isComplete
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground'
                )}
              >
                {isComplete ? <CheckCircle2 className="size-4" /> : index + 1}
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={cn(
                    'mt-2 h-10 w-px rounded-full lg:h-12',
                    isComplete ? 'bg-primary/60' : 'bg-border'
                  )}
                />
              ) : null}
            </div>
            <div className="pt-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  isActive || isComplete ? 'text-foreground' : 'text-muted-foreground'
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

export function PasswordChangeCard() {
  const { profile } = useUserProfile();
  const { showBanner } = useSettingsBanner();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const verificationClient = useMemo(
    () => createSupabaseTransientBrowserClient(),
    []
  );
  const [step, setStep] = useState<PasswordChangeStep>('idle');
  const currentPasswordRef = useRef('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isCurrentPasswordSubmitting, setIsCurrentPasswordSubmitting] = useState(false);
  const [isForgotPasswordRedirecting, setIsForgotPasswordRedirecting] = useState(false);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);

  const currentPasswordForm = useForm<CurrentPasswordValues>({
    resolver: zodResolver(currentPasswordSchema),
    defaultValues: {
      currentPassword: '',
    },
  });

  const forgotPasswordHref = profile?.email
    ? `/forgot-password?email=${encodeURIComponent(profile.email)}&source=settings`
    : '/forgot-password';

  const clearCurrentPassword = () => {
    currentPasswordRef.current = '';
  };

  function resetFlow() {
    setStep('idle');
    clearCurrentPassword();
    setFormError(null);
    currentPasswordForm.reset({ currentPassword: '' });
  }

  useEffect(() => clearCurrentPassword, []);

  function returnToVerificationStep() {
    clearCurrentPassword();
    currentPasswordForm.reset({ currentPassword: '' });
    setStep('verify_current');
  }

  const onCurrentPasswordSubmit = currentPasswordForm.handleSubmit(async (values) => {
    const email = profile?.email?.trim();

    if (!email) {
      setFormError('Deine E-Mail-Adresse konnte nicht geladen werden. Bitte lade die Seite neu.');
      return;
    }

    setIsCurrentPasswordSubmitting(true);
    setFormError(null);
    currentPasswordForm.clearErrors('currentPassword');

    try {
      const { error } = await verificationClient.auth.signInWithPassword({
        email,
        password: values.currentPassword,
      });

      if (error) {
        currentPasswordForm.setError('currentPassword', {
          type: 'manual',
          message: isCurrentPasswordError(error)
            ? 'Dein aktuelles Passwort ist nicht korrekt.'
            : translateSupabasePasswordError(error),
        });
        return;
      }

      await verificationClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
      currentPasswordRef.current = values.currentPassword;
      setStep('set_new');
    } finally {
      setIsCurrentPasswordSubmitting(false);
    }
  });

  async function onPasswordSubmit(values: PasswordWithConfirmationValues) {
    setIsPasswordSubmitting(true);
    setFormError(null);

    const currentPassword = currentPasswordRef.current;

    try {
      if (!currentPassword) {
        setFormError(
          'Bitte bestätige zuerst erneut dein aktuelles Passwort.'
        );
        returnToVerificationStep();
        return;
      }

      if (values.password === currentPassword) {
        setFormError('Das neue Passwort muss sich vom alten Passwort unterscheiden.');
        returnToVerificationStep();
        return;
      }

      const { error } = await supabase.auth.updateUser({
        current_password: currentPassword,
        password: values.password,
      });

      if (error) {
        if (isCurrentPasswordError(error)) {
          returnToVerificationStep();
          currentPasswordForm.setError('currentPassword', {
            type: 'manual',
            message: 'Dein aktuelles Passwort ist nicht korrekt.',
          });
          setFormError(null);
          return;
        }

        returnToVerificationStep();
        setFormError(translateSupabasePasswordError(error));
        return;
      }

      const { error: signOutOthersError } = await supabase.auth.signOut({
        scope: 'others',
      });

      resetFlow();
      showBanner({
        message: signOutOthersError
          ? 'Dein Passwort wurde aktualisiert. Andere Sitzungen konnten nicht automatisch abgemeldet werden.'
          : 'Dein Passwort wurde aktualisiert. Andere Sitzungen wurden abgemeldet.',
        variant: 'success',
      });
    } finally {
      setIsPasswordSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    setFormError(null);
    setIsForgotPasswordRedirecting(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      setFormError(
        'Wir konnten dich nicht sicher abmelden. Bitte versuche es erneut.'
      );
      setIsForgotPasswordRedirecting(false);
      return;
    }

    window.location.replace(forgotPasswordHref);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passwort</CardTitle>
        <CardDescription>
          Bestätige zuerst dein aktuelles Passwort und hinterlege danach ein
          neues. Wenn du dein aktuelles Passwort nicht mehr kennst, kannst du den
          bestehenden Zurücksetzen-Flow verwenden.
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
              <Button type="button" onClick={() => setStep('verify_current')}>
                Passwort ändern
              </Button>
            ) : null}
          </div>
        </div>

        {step !== 'idle' ? (
          <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <PasswordStepIndicator currentStep={step} />

            <div className="space-y-5 rounded-lg border bg-background p-5">
              {formError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {formError}
                </div>
              ) : null}

              {step === 'verify_current' ? (
                <Form {...currentPasswordForm}>
                  <form className="space-y-4" onSubmit={onCurrentPasswordSubmit}>
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-foreground">
                        Schritt 1: Aktuelles Passwort eingeben
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Gib zuerst dein aktuelles Passwort ein. Wenn du es nicht
                        mehr weißt, kannst du den normalen Zurücksetzen-Flow
                        verwenden.
                      </p>
                    </div>

                    <FormField
                      control={currentPasswordForm.control}
                      name="currentPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Aktuelles Passwort</FormLabel>
                          <FormControl>
                            <PasswordInput
                              placeholder="Aktuelles Passwort"
                              autoComplete="current-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
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
                            Weiterleitung...
                          </>
                        ) : (
                          'Passwort vergessen?'
                        )}
                      </Button>{' '}
                      Wenn du dein aktuelles Passwort nicht mehr kennst, melden
                      wir dich ab. Danach kannst du dir per E-Mail einen Link
                      senden lassen und dein Passwort darüber zurücksetzen.
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
                      <Button
                        type="submit"
                        disabled={isCurrentPasswordSubmitting || isForgotPasswordRedirecting}
                      >
                        {isCurrentPasswordSubmitting ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Wird geprüft...
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
              ) : null}

              {step === 'set_new' ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-foreground">
                      <ShieldCheck className="size-4 text-primary" />
                      <p className="text-base font-semibold">
                        Schritt 2: Neues Passwort festlegen
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Hinterlege jetzt dein neues Passwort und bestätige es zur
                      Sicherheit ein zweites Mal.
                    </p>
                  </div>

                  <NewPasswordFieldsForm
                    formError={formError}
                    isSubmitting={isPasswordSubmitting}
                    submitLabel="Passwort aktualisieren"
                    submittingLabel="Passwort wird aktualisiert..."
                    onSubmit={onPasswordSubmit}
                    onBack={() => {
                      setFormError(null);
                      returnToVerificationStep();
                    }}
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
