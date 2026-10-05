import { z } from '@/lib/zod';

import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';

import {
  type EmailChangeActionError,
  type EmailChangeActionResult,
  type EmailChangeWizardState,
} from '@/lib/settings/email-change.types';

export const newEmailSchema = z.object({
  email: z.string().trim().email('Bitte gib eine gültige E-Mail-Adresse ein.'),
});

export type NewEmailValues = z.infer<typeof newEmailSchema>;

export type CompletionState = {
  previousEmail: string;
  newEmail: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function formatRemainingTime(targetIso: string | null, now: number): string | null {
  if (!targetIso) {
    return null;
  }

  const diffMs = new Date(targetIso).getTime() - now;
  if (diffMs <= 0) {
    return '00:00';
  }

  const totalSeconds = Math.ceil(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function isExpired(targetIso: string | null, now: number): boolean {
  if (!targetIso) {
    return false;
  }

  return new Date(targetIso).getTime() <= now;
}

// The shared codes, `unexpected_error` among them, read their sentence from describeFailure.
const EMAIL_CHANGE_ERROR_MESSAGES: Readonly<
  Record<Exclude<EmailChangeActionError, 'unexpected_error'>, string>
> = {
  cooldown: 'Bitte warte kurz, bevor du einen neuen Code anforderst.',
  challenge_not_found: 'Der Änderungsprozess ist nicht mehr aktiv. Bitte starte ihn erneut.',
  challenge_expired: 'Der Code ist abgelaufen. Bitte starte die Änderung erneut.',
  // Wrong codes for the current address and the hourly code budget share this code.
  too_many_attempts: 'Zu viele Versuche. Bitte warte etwas und fordere dann einen neuen Code an.',
  invalid_code: 'Der eingegebene Code ist ungültig.',
  current_email_not_verified: 'Bestätige zuerst deine aktuelle E-Mail-Adresse.',
  verification_window_expired:
    'Die Zeit zum Eingeben deiner neuen E-Mail-Adresse ist abgelaufen. Bitte starte den Flow erneut.',
  invalid_email: 'Bitte gib eine gültige, neue E-Mail-Adresse ein.',
  email_send_failed: 'Der Bestätigungscode konnte gerade nicht gesendet werden. Bitte versuche es erneut.',
  new_email_code_expired:
    'Der Code für die neue E-Mail-Adresse ist abgelaufen. Bitte fordere einen neuen Code an.',
  new_email_invalid_code: 'Der Code für die neue E-Mail-Adresse ist ungültig.',
  new_email_too_many_attempts:
    'Zu viele falsche Versuche für die neue E-Mail-Adresse. Bitte sende einen neuen Code.',
  not_authenticated: 'Du bist nicht mehr angemeldet. Bitte lade die Seite neu.',
  no_active_email: 'Für dieses Konto ist aktuell keine bestätigte E-Mail-Adresse verfügbar.',
  completion_pending:
    'Die E-Mail-Änderung wurde angefragt, aber noch nicht bestätigt. Bitte prüfe den Status. Bleibt er unverändert, wende dich an den WerkFlow-Support.',
};

function translateActionError(error?: EmailChangeActionError): string {
  return describeFailure(
    error ?? 'unexpected_error',
    EMAIL_CHANGE_ERROR_MESSAGES,
    SHARED_FAILURE_MESSAGES.unexpected_error,
  );
}

export function applyResultError(
  result: EmailChangeActionResult,
  setState: (state: EmailChangeWizardState) => void,
  setError: (error: string | null) => void,
): void {
  setState(result.state);
  setError(result.success ? null : translateActionError(result.error));
}

export type EmailChangeTimers = {
  currentOtpResendLocked: boolean;
  newEmailResendLocked: boolean;
  currentOtpCountdown: string | null;
  newEmailResendCountdown: string | null;
  currentOtpExpiryCountdown: string | null;
  currentEmailVerificationWindowCountdown: string | null;
  newEmailOtpExpiryCountdown: string | null;
  currentEmailVerificationWindowExpired: boolean;
};

/** Every countdown and lock the wizard shows, derived from the server state and the wall clock. */
export function deriveEmailChangeTimers(wizardState: EmailChangeWizardState, now: number): EmailChangeTimers {
  const currentOtpResendLocked = !isExpired(wizardState.currentOtpResendAvailableAt, now);
  const newEmailResendLocked = !isExpired(wizardState.newEmailResendAvailableAt, now);
  const currentOtpCountdown = formatRemainingTime(wizardState.currentOtpResendAvailableAt, now);
  const newEmailResendCountdown = formatRemainingTime(wizardState.newEmailResendAvailableAt, now);
  const currentOtpExpiryCountdown = formatRemainingTime(wizardState.currentOtpExpiresAt, now);
  const currentEmailVerificationWindowCountdown = formatRemainingTime(
    wizardState.currentEmailVerifiedExpiresAt,
    now,
  );
  const newEmailOtpExpiryCountdown = formatRemainingTime(wizardState.newEmailOtpExpiresAt, now);
  const currentEmailVerificationWindowExpired = isExpired(wizardState.currentEmailVerifiedExpiresAt, now);

  return {
    currentOtpResendLocked,
    newEmailResendLocked,
    currentOtpCountdown,
    newEmailResendCountdown,
    currentOtpExpiryCountdown,
    currentEmailVerificationWindowCountdown,
    newEmailOtpExpiryCountdown,
    currentEmailVerificationWindowExpired,
  };
}
