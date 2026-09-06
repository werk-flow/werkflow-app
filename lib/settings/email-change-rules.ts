// Pure rules of the dual-OTP email change. Both mail confirmations are
// required: the current address proves account ownership, the new address
// proves reachability. A `pending_new` challenge may only be used while the
// current-address verification is still valid (SI-016).

export type EmailChangeChallengeFacts = {
  status: 'pending_current' | 'current_verified' | 'pending_new';
  currentEmailVerifiedAt: string | null;
  currentEmailVerifiedExpiresAt: string | null;
};

export function isCurrentEmailVerificationValid(
  challenge: EmailChangeChallengeFacts | null,
  now: Date
): boolean {
  if (
    !challenge ||
    !challenge.currentEmailVerifiedAt ||
    !challenge.currentEmailVerifiedExpiresAt
  ) {
    return false;
  }
  return new Date(challenge.currentEmailVerifiedExpiresAt).getTime() > now.getTime();
}

/** A new-address code may be (re)sent only for an existing pending_new challenge whose current verification is valid. */
export function canResendNewEmailCode(
  challenge: EmailChangeChallengeFacts | null,
  now: Date
): boolean {
  return challenge?.status === 'pending_new' && isCurrentEmailVerificationValid(challenge, now);
}

/** The final step may change the account email only when the current address was verified in this flow. */
export function canCompleteEmailChange(
  challenge: EmailChangeChallengeFacts | null,
  now: Date
): boolean {
  return challenge?.status === 'pending_new' && isCurrentEmailVerificationValid(challenge, now);
}
