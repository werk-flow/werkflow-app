'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from '@/components/ui/field';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot
} from '@/components/ui/input-otp';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const RESEND_COOLDOWN_SECONDS = 60;

type OTPFormProps = React.ComponentProps<typeof Card> & {
  email: string;
  inviteCode?: string;
};

export function OTPForm({
  email,
  inviteCode,
  className,
  ...props
}: OTPFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setResendCooldown((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [resendCooldown]);

  const maskedEmail = (() => {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) {
      return email;
    }
    const obfuscatedLocal =
      localPart.length <= 3
        ? `${localPart[0] ?? ''}***`
        : `${localPart.slice(0, 3)}***`;
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

    setIsSubmitting(true);

    try {
      const {
        data: { session },
        error
      } = await supabase.auth.verifyOtp({
        email,
        token: sanitizedCode,
        type: 'email'
      });

      if (error || !session) {
        console.error('Failed to verify OTP', error);
        setFormError(
          'Der Code ist ungültig oder abgelaufen. Bitte versuche es erneut.'
        );
        setIsSubmitting(false);
        return;
      }

      await fetch('/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event: 'SIGNED_IN',
          session
        })
      });

      // Note: Profile is automatically created by database trigger on auth.users INSERT
      // The trigger extracts first_name and last_name from user_metadata

      // Determine the invite code to use:
      // 1. If inviteCode prop is passed (user came from invite link), use that
      // 2. Otherwise, check user metadata for pending_invite_code (user signed up via invite but logged in elsewhere)
      const effectiveInviteCode =
        inviteCode ||
        (session.user.user_metadata?.pending_invite_code as string | undefined);

      // If there's an invite code, redeem it via server action to ensure proper auth context
      if (effectiveInviteCode) {
        try {
          const response = await fetch('/api/redeem-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteCode: effectiveInviteCode })
          });

          const result = await response.json();

          if (!response.ok) {
            console.error('Failed to redeem invite:', result);
            if (result.error === 'email_mismatch') {
              const invitedEmail = result.invitedEmail || '';
              window.location.href = `/invite-error?error=email_mismatch&email=${encodeURIComponent(
                invitedEmail
              )}&invite_code=${effectiveInviteCode}`;
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
              window.location.href = '/invite-error?error=invite_already_used';
              return;
            }
            if (result.error === 'invalid_invite') {
              window.location.href = '/invite-error?error=invalid_invite';
              return;
            }
            // For other errors, continue to dashboard
          } else if (result.success && result.organizationId) {
            // Successfully redeemed - cookie is already set by the API
            // Clear the pending_invite_code from user metadata since it's been used
            await supabase.auth.updateUser({
              data: { pending_invite_code: null }
            });
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

      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      console.error('Unexpected error verifying OTP', error);
      setFormError(
        'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut.'
      );
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || isResending) {
      return;
    }

    setFormError(null);
    setIsResending(true);

    try {
      // Use resend method to resend the signup confirmation email (OTP)
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email
      });

      if (error) {
        console.error('Failed to resend OTP', error);
        setFormError(
          'Der Code konnte nicht erneut gesendet werden. Bitte versuche es später erneut.'
        );
      } else {
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch (error) {
      console.error('Unexpected error during resend', error);
      setFormError(
        'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es später erneut.'
      );
    } finally {
      setIsResending(false);
    }
  }

  return (
    <Card className={className} {...props}>
      <CardHeader>
        <CardTitle>Verifizierungscode eingeben</CardTitle>
        <CardDescription>
          Wir haben einen sechsstelligen Code an {maskedEmail} gesendet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="otp">Verifizierungscode</FieldLabel>
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
              <FieldDescription>
                Bitte gib den sechsstelligen Code ein, um dein Konto zu
                bestätigen.
              </FieldDescription>
            </Field>

            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}

            <FieldGroup>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Überprüfung läuft...' : 'Code bestätigen'}
              </Button>
              <FieldDescription className="text-center">
                Code nicht erhalten?{' '}
                {resendCooldown > 0 ? (
                  <span className="text-muted-foreground">
                    Erneut senden in {resendCooldown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isResending}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {isResending ? 'Sende erneut...' : 'Erneut senden'}
                  </button>
                )}
              </FieldDescription>
            </FieldGroup>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
