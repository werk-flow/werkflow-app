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

export function SignupForm() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
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
  const { isValid } = form.formState;
  const canSubmit = passwordRequirements.allMet && isValid && !isSubmitting;

  const handleSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    form.clearErrors('password');
    setIsSubmitting(true);

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: {
          first_name: values.firstName,
          last_name: values.lastName
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

    router.replace(`/verify?email=${encodeURIComponent(values.email)}`);
    router.refresh();
  });

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vorname</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="given-name"
                    placeholder="Max"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nachname</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="family-name"
                    placeholder="Mustermann"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

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
