'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { createSupabaseImplicitClient } from '@/lib/supabase/implicit-client';

const forgotPasswordSchema = z.object({
  email: z.string().email('Bitte gib eine gültige E-Mail-Adresse ein.')
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

type ForgotPasswordFormProps = {
  initialEmail?: string;
  serverErrorMessage?: string | null;
  isKnownAccountReset?: boolean;
};

export function ForgotPasswordForm({
  initialEmail = '',
  serverErrorMessage = null,
  isKnownAccountReset = false,
}: ForgotPasswordFormProps) {
  const router = useRouter();
  // Use implicit client for password reset to enable cross-browser links
  // The flow type is determined by which client sends the email request
  const supabase = useMemo(() => createSupabaseImplicitClient(), []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: initialEmail
    }
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);

    try {
      // Note: Configure the Supabase email template in the Supabase dashboard
      // under Authentication > Email Templates > Reset Password to ensure
      // it's user-friendly and clearly explains that the user must click
      // the link to reset their password.

      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

      try {
        // Always succeeds regardless of whether email exists (prevents enumeration)
        await supabase.auth.resetPasswordForEmail(values.email, {
          redirectTo: `${siteUrl}/reset-password`
        });
      } catch (error) {
        // Silently handle errors to prevent enumeration
        console.error('Password reset error:', error);
      }

      const fallbackMessageKey = isKnownAccountReset
        ? 'password-reset-requested-known-user'
        : 'password-reset-requested';
      let loginRedirectHref = '/login';

      try {
        await fetch('/auth/flash', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: fallbackMessageKey
          })
        });
      } catch (error) {
        console.error('Failed to store auth flash message:', error);
        loginRedirectHref = `/login?message=${fallbackMessageKey}`;
      }

      // Always redirect with neutral message, never reveal if email exists
      router.push(loginRedirectHref);
    } finally {
      // Reset submitting state in case redirect fails or is delayed
      setIsSubmitting(false);
    }
  });

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <ErrorText>{serverErrorMessage}</ErrorText>
        <FormField
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field label="E-Mail" required error={fieldState.error?.message}>
              <Input
                {...field}
                type="email"
                autoComplete="email"
                placeholder="beispiel@firma.de"
              />
            </Field>
          )}
        />

        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Wird gesendet...' : 'Link senden'}
        </Button>
      </form>
    </Form>
  );
}
