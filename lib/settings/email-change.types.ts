export const CURRENT_EMAIL_OTP_LENGTH = 6;
export const CURRENT_EMAIL_OTP_EXPIRY_MINUTES = 10;
export const CURRENT_EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const CURRENT_EMAIL_VERIFICATION_WINDOW_MINUTES = 10;
export const CURRENT_EMAIL_MAX_ATTEMPTS = 5;

export type EmailChangeWizardStep =
  | 'idle'
  | 'verify_current'
  | 'enter_new'
  | 'verify_new';

export type EmailChangeWizardState = {
  step: EmailChangeWizardStep;
  currentEmail: string | null;
  newEmail: string | null;
  currentOtpExpiresAt: string | null;
  currentOtpResendAvailableAt: string | null;
  currentEmailVerifiedExpiresAt: string | null;
  newEmailOtpExpiresAt: string | null;
  newEmailResendAvailableAt: string | null;
};

export type EmailChangeActionError =
  | 'not_authenticated'
  | 'no_active_email'
  | 'cooldown'
  | 'challenge_not_found'
  | 'challenge_expired'
  | 'too_many_attempts'
  | 'invalid_code'
  | 'current_email_not_verified'
  | 'verification_window_expired'
  | 'invalid_email'
  | 'email_send_failed'
  | 'new_email_code_expired'
  | 'new_email_invalid_code'
  | 'new_email_too_many_attempts'
  | 'unexpected_error';

export type EmailChangeActionResult = {
  success: boolean;
  error?: EmailChangeActionError;
  state: EmailChangeWizardState;
};
