'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { PasswordRequirements } from '@/components/password/PasswordRequirements';
import { PasswordStrengthMeter } from '@/components/password/PasswordStrengthMeter';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { invalidateProfileCache } from '@/lib/auth/actions';
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


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setFormError(null);
    form.clearErrors('password');

    const values = form.getValues();
    let firstInvalidField: keyof SignupValues | null = null;

    // Validate name fields manually
    if (values.firstName.length < 2) {
      form.setError('firstName', {
        type: 'manual',
        message: 'Der Vorname muss mindestens 2 Zeichen lang sein.'
      });
      firstInvalidField ??= 'firstName';
    }

    if (values.lastName.length < 2) {
      form.setError('lastName', {
        type: 'manual',
        message: 'Der Nachname muss mindestens 2 Zeichen lang sein.'
      });
      firstInvalidField ??= 'lastName';
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(values.email)) {
      form.setError('email', {
        type: 'manual',
        message: 'Bitte gib eine gültige E-Mail-Adresse ein.'
      });
      firstInvalidField ??= 'email';
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
      firstInvalidField ??= 'email';
    }

    // The requirements checklist under the field already names what is
    // missing; focusing the field is the only extra signal needed.
    if (!passwordRequirements.allMet) {
      firstInvalidField ??= 'password';
    }

    if (firstInvalidField) {
      form.setFocus(firstInvalidField);
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

      await invalidateProfileCache(data.user.id);
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
            render={({ field, fieldState }) => (
              <Field
                label="Vorname"
                required
                error={hasAttemptedSubmit ? fieldState.error?.message : undefined}
              >
                <Input autoComplete="given-name" placeholder="Max" {...field} />
              </Field>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field, fieldState }) => (
              <Field
                label="Nachname"
                required
                error={hasAttemptedSubmit ? fieldState.error?.message : undefined}
              >
                <Input
                  autoComplete="family-name"
                  placeholder="Mustermann"
                  {...field}
                />
              </Field>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field
              label="E-Mail"
              required
              description={
                isInviteSignup
                  ? 'Die E-Mail-Adresse ist durch die Einladung vorgegeben.'
                  : undefined
              }
              error={hasAttemptedSubmit ? fieldState.error?.message : undefined}
            >
              <Input
                {...field}
                type="text"
                inputMode="email"
                autoComplete="email"
                placeholder="beispiel@firma.de"
                readOnly={isInviteSignup}
                className={
                  isInviteSignup ? 'bg-muted cursor-not-allowed' : ''
                }
              />
            </Field>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            // Client-side rules are already visible in the requirements
            // checklist; only server rejections (e.g. the leaked-password
            // check) carry information the checklist cannot show.
            <Field
              label="Passwort"
              required
              error={
                fieldState.error?.type === 'server'
                  ? fieldState.error.message
                  : undefined
              }
            >
              <PasswordInput {...field} autoComplete="new-password" />
              <PasswordStrengthMeter
                className="mt-2"
                level={passwordStrength}
              />
              <PasswordRequirements
                className="mt-2"
                requirements={passwordRequirements}
              />
            </Field>
          )}
        />

        <ErrorText>{formError}</ErrorText>

        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Konto wird erstellt...' : 'Registrieren'}
        </Button>
      </form>
    </Form>
  );
}
