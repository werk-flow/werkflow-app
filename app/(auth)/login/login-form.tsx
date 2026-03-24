'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

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

const loginSchema = z.object({
  email: z.string().email('Bitte gib eine gültige E-Mail-Adresse ein.'),
  password: z
    .string()
    .min(6, 'Das Passwort muss mindestens 6 Zeichen lang sein.')
});

type LoginValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  successMessage?: string;
  inviteCode?: string;
}

export function LoginForm({ successMessage, inviteCode = '' }: LoginFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: ''
    }
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setIsSubmitting(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password
    });

    if (error) {
      console.error('Failed to sign in', error);

      const errorMessage = error.message?.toLowerCase() ?? '';
      if (
        errorMessage.includes('email not confirmed') ||
        errorMessage.includes('email_not_confirmed')
      ) {
        const { error: resendError } = await supabase.auth.resend({
          type: 'signup',
          email: values.email
        });

        if (resendError) {
          console.error('Failed to resend OTP:', resendError);
          setFormError(
            'E-Mail nicht verifiziert. Bitte überprüfe dein Postfach oder versuche es erneut.'
          );
          setIsSubmitting(false);
          return;
        }

        const verifyUrl = inviteCode
          ? `/verify?email=${encodeURIComponent(
              values.email
            )}&invite_code=${inviteCode}`
          : `/verify?email=${encodeURIComponent(values.email)}`;
        router.replace(verifyUrl);
        router.refresh();
        return;
      }

      setFormError(
        'Anmeldung fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.'
      );
      setIsSubmitting(false);
      return;
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

      if (inviteCode) {
        try {
          const response = await fetch('/api/redeem-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteCode })
          });

          const result = await response.json();

          if (!response.ok) {
            console.error('Failed to redeem invite:', result);
            if (result.error === 'email_mismatch') {
              const invitedEmail = result.invitedEmail || '';
              window.location.assign(`/invite-error?error=email_mismatch&email=${encodeURIComponent(
                invitedEmail
              )}&invite_code=${inviteCode}`);
              return;
            }
            if (result.error === 'admin_mismatch') {
              window.location.assign('/invite-error?error=admin_mismatch');
              return;
            }
            if (result.error === 'invite_expired') {
              window.location.assign('/invite-error?error=invite_expired');
              return;
            }
            if (result.error === 'invite_cancelled') {
              window.location.assign('/invite-error?error=invite_cancelled');
              return;
            }
            if (result.error === 'invite_already_used') {
              window.location.assign('/invite-error?error=invite_already_used');
              return;
            }
            if (result.error === 'invalid_invite') {
              window.location.assign('/invite-error?error=invalid_invite');
              return;
            }
          } else if (result.success && result.organizationId) {
            if (result.alreadyMember) {
              window.location.assign(
                `/dashboard?already_member=${result.organizationId}`
              );
            } else {
              window.location.assign(`/dashboard?joined=${result.organizationId}`);
            }
            return;
          }
        } catch (err) {
          console.error('Error redeeming invite:', err);
        }
      }
    }

    // Keep isSubmitting=true — the component unmounts on navigation
    router.replace('/');
    router.refresh();
  });

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        {successMessage ? (
          <div className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">
            {successMessage}
          </div>
        ) : null}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>E-Mail</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  placeholder="beispiel@firma.de"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Passwort</FormLabel>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Passwort vergessen?
                </Link>
              </div>
              <FormControl>
                <PasswordInput {...field} autoComplete="current-password" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError ? (
          <p className="text-sm text-destructive">{formError}</p>
        ) : null}

        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Anmeldung läuft...' : 'Anmelden'}
        </Button>
      </form>
    </Form>
  );
}
