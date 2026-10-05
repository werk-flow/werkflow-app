'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { redeemOtpInvite } from '@/components/otp-form-invite';
import { useOtpResend } from '@/components/use-otp-form-resend';

type OTPFormProps = React.ComponentProps<typeof Card> & {
  email: string;
  inviteCode?: string | undefined;
};

export function OTPForm({ email, inviteCode, className, ...props }: OTPFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const { run: runSubmit, isPending: isSubmitting } = usePendingTask();
  const { resendCooldown, isResending, handleResend } = useOtpResend({
    supabase,
    email,
    setFormError,
  });

  const maskedEmail = (() => {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) {
      return email;
    }
    const obfuscatedLocal =
      localPart.length <= 3 ? `${localPart[0] ?? ''}***` : `${localPart.slice(0, 3)}***`;
    return `${obfuscatedLocal}@${domain}`;
  })();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const sanitizedCode = code.replace(/\D/g, '');
    if (sanitizedCode.length !== 6) {
      setFormError('Bitte gib den vollständigen sechsstelligen Code ein.');
      return;
    }

    await runSubmit(async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.verifyOtp({
          email,
          token: sanitizedCode,
          type: 'email',
        });

        if (error || !session) {
          setFormError('Der Code ist ungültig oder abgelaufen. Bitte versuche es erneut.');
          return;
        }

        await fetch('/auth/callback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event: 'SIGNED_IN',
            session,
          }),
        });

        // Note: Profile is automatically created by database trigger on auth.users INSERT
        // The trigger extracts first_name and last_name from user_metadata

        // Determine the invite code to use:
        // 1. If inviteCode prop is passed (user came from invite link), use that
        // 2. Otherwise, check user metadata for pending_invite_code (user signed up via invite but logged in elsewhere)
        const effectiveInviteCode =
          inviteCode || (session.user.user_metadata?.pending_invite_code as string | undefined);

        // If there's an invite code, redeem it via server action to ensure proper auth context
        if (effectiveInviteCode) {
          if (await redeemOtpInvite(supabase, effectiveInviteCode)) return untilPageLeaves();
        }

        router.replace('/');
        router.refresh();
        return untilPageLeaves();
      } catch {
        setFormError('Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut.');
      }
    });
  }
  return (
    <Card className={className} {...props}>
      <CardHeader>
        <CardTitle>Verifizierungscode eingeben</CardTitle>
        <CardDescription>Wir haben einen sechsstelligen Code an {maskedEmail} gesendet.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6">
            <Field
              label="Verifizierungscode"
              htmlFor="otp"
              description="Bitte gib den sechsstelligen Code ein, um dein Konto zu bestätigen."
            >
              <InputOTP
                id="otp"
                autoFocus
                value={code}
                onChange={setCode}
                maxLength={6}
                className="font-mono text-lg"
                pattern="[0-9]*"
              >
                <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </Field>

            <ErrorText>{formError}</ErrorText>

            <div className="flex flex-col gap-4">
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Überprüfung läuft…' : 'Code bestätigen'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Code nicht erhalten?{' '}
                {resendCooldown > 0 ? (
                  <span className="text-muted-foreground">Erneut senden in {resendCooldown}s</span>
                ) : (
                  <PlainButton
                    type="button"
                    onClick={handleResend}
                    disabled={isResending}
                    className="text-primary-text underline-offset-4 hover:underline"
                  >
                    {isResending ? 'Sende erneut…' : 'Erneut senden'}
                  </PlainButton>
                )}
              </p>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
