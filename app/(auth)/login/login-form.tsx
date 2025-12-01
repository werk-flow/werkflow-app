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

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password
      });

      if (error) {
        console.error('Failed to sign in', error);

        // Check if the error is due to unverified email
        // Supabase returns "Email not confirmed" for unverified users
        const errorMessage = error.message?.toLowerCase() ?? '';
        if (
          errorMessage.includes('email not confirmed') ||
          errorMessage.includes('email_not_confirmed')
        ) {
          // Resend OTP to the user's email
          const { error: resendError } = await supabase.auth.resend({
            type: 'signup',
            email: values.email
          });

          if (resendError) {
            console.error('Failed to resend OTP:', resendError);
            setFormError(
              'E-Mail nicht verifiziert. Bitte überprüfe dein Postfach oder versuche es erneut.'
            );
            return;
          }

          // Redirect to verify page with the email
          // Include invite code if present
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

        // If there's an invite code, redeem it via server API
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
                window.location.href = `/invite-error?error=email_mismatch&email=${encodeURIComponent(
                  invitedEmail
                )}&invite_code=${inviteCode}`;
                return;
              }
              if (result.error === 'admin_mismatch') {
                window.location.href = '/invite-error?error=admin_mismatch';
                return;
              }
              if (result.error === 'invite_expired') {
                window.location.href = '/invite-error?error=invite_expired';
                return;
              }
              if (result.error === 'invite_cancelled') {
                window.location.href = '/invite-error?error=invite_cancelled';
                return;
              }
              if (result.error === 'invite_already_used') {
                window.location.href =
                  '/invite-error?error=invite_already_used';
                return;
              }
              if (result.error === 'invalid_invite') {
                window.location.href = '/invite-error?error=invalid_invite';
                return;
              }
              // For other errors, continue to dashboard
            } else if (result.success && result.organizationId) {
              // Successfully redeemed - cookie is already set by the API
              // Use hard navigation to ensure the cookie is read correctly
              if (result.alreadyMember) {
                window.location.href = `/dashboard?already_member=${result.organizationId}`;
              } else {
                window.location.href = `/dashboard?joined=${result.organizationId}`;
              }
              return;
            }
          } catch (err) {
            console.error('Error redeeming invite:', err);
            // Continue to dashboard on error
          }
        }
      }

      router.replace('/dashboard');
      router.refresh();
    } finally {
      // Reset submitting state in case redirect fails or is delayed
      setIsSubmitting(false);
    }
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
