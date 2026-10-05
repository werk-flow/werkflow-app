'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { z } from '@/lib/zod';

import { redeemOtpInvite } from '@/components/otp-form-invite';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const loginSchema = z.object({
  email: z.string().email('Bitte gib eine gültige E-Mail-Adresse ein.'),
  password: z.string().min(1, 'Bitte gib dein Passwort ein.'),
});

type LoginValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  successMessage?: string | undefined;
  inviteCode?: string;
}

export function LoginForm({ successMessage, inviteCode = '' }: LoginFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [formError, setFormError] = useState<string | null>(null);
  const { run: runSubmit, isPending: isSubmitting } = usePendingTask();

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    await runSubmit(async () => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        });

        if (error) {
          const errorMessage = error.message?.toLowerCase() ?? '';
          if (errorMessage.includes('email not confirmed') || errorMessage.includes('email_not_confirmed')) {
            const { error: resendError } = await supabase.auth.resend({
              type: 'signup',
              email: values.email,
            });

            if (resendError) {
              setFormError(
                'E-Mail nicht verifiziert. Bitte überprüfe dein Postfach oder versuche es erneut.',
              );
              return;
            }

            const verifyUrl = inviteCode
              ? `/verify?email=${encodeURIComponent(values.email)}&invite_code=${encodeURIComponent(inviteCode)}`
              : `/verify?email=${encodeURIComponent(values.email)}`;
            router.replace(verifyUrl);
            router.refresh();
            return untilPageLeaves();
          }

          setFormError('Anmeldung fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.');
          return;
        }

        if (data.session) {
          await fetch('/auth/callback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              event: 'SIGNED_IN',
              session: data.session,
            }),
          });

          if (inviteCode && (await redeemOtpInvite(supabase, inviteCode))) return untilPageLeaves();
        }

        router.replace('/');
        router.refresh();
        return untilPageLeaves();
      } catch {
        // A rejected request (network) must not leave the button spinning.
        setFormError('Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
      }
    });
  });

  return (
    <Form {...form}>
      {/* method="post" guards the pre-hydration fallback: a native GET submit
          would put the credentials into the URL and server logs. */}
      <form className="grid gap-4" method="post" onSubmit={handleSubmit}>
        {successMessage ? (
          <div className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">{successMessage}</div>
        ) : null}

        <FormField
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field label="E-Mail" required error={fieldState.error?.message}>
              <Input {...field} type="email" autoComplete="email" placeholder="beispiel@firma.de" />
            </Field>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <div className="grid gap-2">
              <Field label="Passwort" required error={fieldState.error?.message}>
                <PasswordInput {...field} autoComplete="current-password" />
              </Field>
              <Link
                href="/forgot-password"
                className="justify-self-end text-sm text-primary-text underline-offset-4 hover:underline"
              >
                Passwort vergessen?
              </Link>
            </div>
          )}
        />

        <ErrorText>{formError}</ErrorText>

        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Anmeldung läuft…' : 'Anmelden'}
        </Button>
      </form>
    </Form>
  );
}
