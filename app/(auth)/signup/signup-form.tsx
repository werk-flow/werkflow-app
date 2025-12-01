'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { PasswordRequirements } from '@/components/password/PasswordRequirements';
import { PasswordStrengthMeter } from '@/components/password/PasswordStrengthMeter';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  getPasswordRequirements,
  getPasswordStrengthLevel,
  passwordSchema,
  translateSupabasePasswordError
} from '@/lib/validation/password';

const signupSchema = z.object({
  firstName: z
    .string()
    .min(2, 'Der Vorname muss mindestens 2 Zeichen lang sein.'),
  lastName: z
    .string()
    .min(2, 'Der Nachname muss mindestens 2 Zeichen lang sein.'),
  email: z.string().email('Bitte gib eine gültige E-Mail-Adresse ein.'),
  password: passwordSchema
});

type SignupValues = z.infer<typeof signupSchema>;

// Helper to mask email for privacy (e.g., "test@example.com" -> "t***@example.com")
function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!domain) return email;
  const maskedLocal =
    localPart.length > 1 ? localPart[0] + '***' : localPart + '***';
  return `${maskedLocal}@${domain}`;
}

interface SignupFormProps {
  prefillEmail?: string;
  inviteCode?: string;
  invitedEmail?: string | null;
}

export function SignupForm({
  prefillEmail = '',
  inviteCode = '',
  invitedEmail = null
}: SignupFormProps) {
  // Determine if this is an invite-based signup (email should be locked)
  const isInviteSignup = !!inviteCode && !!invitedEmail;
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: {
      firstName: '',
      lastName: '',
      email: prefillEmail,
      password: ''
    }
  });

  const passwordValue =
    useWatch({
      control: form.control,
      name: 'password'
    }) ?? '';
  const passwordRequirements = useMemo(
    () => getPasswordRequirements(passwordValue),
    [passwordValue]
  );
  const passwordStrength = useMemo(
    () => getPasswordStrengthLevel(passwordValue),
    [passwordValue]
  );

  // Watch name fields to check if they're filled
  const firstNameValue =
    useWatch({ control: form.control, name: 'firstName' }) ?? '';
  const lastNameValue =
    useWatch({ control: form.control, name: 'lastName' }) ?? '';
  const emailValue = useWatch({ control: form.control, name: 'email' }) ?? '';

  // Button is enabled if all fields are filled and password meets requirements
  // Name length validation only happens on submit
  const allFieldsFilled =
    firstNameValue.length > 0 &&
    lastNameValue.length > 0 &&
    emailValue.length > 0 &&
    passwordValue.length > 0;
  const canSubmit =
    passwordRequirements.allMet && allFieldsFilled && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setFormError(null);
    form.clearErrors('password');

    const values = form.getValues();
    let hasValidationErrors = false;

    // Validate name fields manually
    if (values.firstName.length < 2) {
      form.setError('firstName', {
        type: 'manual',
        message: 'Der Vorname muss mindestens 2 Zeichen lang sein.'
      });
      hasValidationErrors = true;
    }

    if (values.lastName.length < 2) {
      form.setError('lastName', {
        type: 'manual',
        message: 'Der Nachname muss mindestens 2 Zeichen lang sein.'
      });
      hasValidationErrors = true;
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(values.email)) {
      form.setError('email', {
        type: 'manual',
        message: 'Bitte gib eine gültige E-Mail-Adresse ein.'
      });
      hasValidationErrors = true;
    }

    // If this is an invite signup, ensure the email matches the invited email
    // This is a client-side safety check (server will also validate)
    if (
      isInviteSignup &&
      invitedEmail &&
      values.email.toLowerCase() !== invitedEmail.toLowerCase()
    ) {
      form.setError('email', {
        type: 'manual',
        message: `Diese Einladung ist für ${maskEmail(invitedEmail)} bestimmt.`
      });
      hasValidationErrors = true;
    }

    // Check password requirements
    if (!passwordRequirements.allMet) {
      hasValidationErrors = true;
    }

    if (hasValidationErrors) {
      return;
    }

    setIsSubmitting(true);

    // Store invite_code in user metadata if this is an invite-based signup
    // This allows us to redeem the invite even if the user closes the window
    // and logs in elsewhere (as long as they signed up via the invite link)
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: {
          first_name: values.firstName,
          last_name: values.lastName,
          // Only store invite_code if this is an invite-based signup
          ...(isInviteSignup && inviteCode
            ? { pending_invite_code: inviteCode }
            : {})
        }
      }
    });

    if (error) {
      console.error('Failed to sign up', error);
      const normalizedMessage = error.message?.toLowerCase() ?? '';
      const isPasswordError = normalizedMessage.includes('password');

      if (isPasswordError) {
        const friendly = translateSupabasePasswordError(error);
        form.setError('password', { type: 'server', message: friendly });
        form.resetField('password', {
          keepDirty: false,
          keepError: true,
          defaultValue: ''
        });
        setFormError(null);
      } else {
        setFormError(
          'Registrierung fehlgeschlagen. Bitte überprüfe deine Angaben.'
        );
      }
      setIsSubmitting(false);
      return;
    }

    if (data.session && data.user) {
      const { error: profileError } = await supabase.from('profiles').upsert(
        {
          id: data.user.id,
          first_name: values.firstName,
          last_name: values.lastName
        },
        { onConflict: 'id' }
      );

      if (profileError) {
        console.error('Failed to upsert profile', profileError);
        setFormError(
          'Dein Profil konnte nicht gespeichert werden. Bitte versuche es erneut.'
        );
        setIsSubmitting(false);
        return;
      }
    }

    if (data.session) {
      await fetch('/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event: 'SIGNED_IN',
          session: data.session
        })
      });
    }

    // Include invite_code in the verify redirect if present
    const verifyUrl = inviteCode
      ? `/verify?email=${encodeURIComponent(
          values.email
        )}&invite_code=${inviteCode}`
      : `/verify?email=${encodeURIComponent(values.email)}`;
    router.replace(verifyUrl);
    router.refresh();
  };

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel
                  className={
                    !hasAttemptedSubmit
                      ? 'data-[error=true]:text-foreground'
                      : ''
                  }
                >
                  Vorname
                </FormLabel>
                <FormControl>
                  <Input
                    autoComplete="given-name"
                    placeholder="Max"
                    {...field}
                    aria-invalid={hasAttemptedSubmit ? undefined : false}
                  />
                </FormControl>
                {/* Only show error after user attempts to submit */}
                {hasAttemptedSubmit && <FormMessage />}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel
                  className={
                    !hasAttemptedSubmit
                      ? 'data-[error=true]:text-foreground'
                      : ''
                  }
                >
                  Nachname
                </FormLabel>
                <FormControl>
                  <Input
                    autoComplete="family-name"
                    placeholder="Mustermann"
                    {...field}
                    aria-invalid={hasAttemptedSubmit ? undefined : false}
                  />
                </FormControl>
                {/* Only show error after user attempts to submit */}
                {hasAttemptedSubmit && <FormMessage />}
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel
                className={
                  !hasAttemptedSubmit ? 'data-[error=true]:text-foreground' : ''
                }
              >
                E-Mail
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="beispiel@firma.de"
                  readOnly={isInviteSignup}
                  aria-invalid={hasAttemptedSubmit ? undefined : false}
                  className={
                    isInviteSignup ? 'bg-muted cursor-not-allowed' : ''
                  }
                />
              </FormControl>
              {isInviteSignup && (
                <p className="text-xs text-muted-foreground">
                  Die E-Mail-Adresse ist durch die Einladung vorgegeben.
                </p>
              )}
              {/* Only show error after user attempts to submit */}
              {hasAttemptedSubmit && <FormMessage />}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Passwort</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" />
              </FormControl>
              <PasswordStrengthMeter
                className="mt-2"
                level={passwordStrength}
              />
              <PasswordRequirements
                className="mt-2"
                requirements={passwordRequirements}
              />
              <FormMessage aria-hidden className="hidden" />
            </FormItem>
          )}
        />

        {formError ? (
          <p className="text-sm text-destructive">{formError}</p>
        ) : null}

        <Button className="w-full" disabled={!canSubmit} type="submit">
          {isSubmitting ? 'Konto wird erstellt...' : 'Registrieren'}
        </Button>
      </form>
    </Form>
  );
}
