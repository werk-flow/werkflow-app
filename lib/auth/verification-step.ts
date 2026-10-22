// The way from the signup, or the login of an unconfirmed account, to the
// code step. The address goes to `POST /auth/verify-address`, which keeps it
// in a cookie scoped to `/verify`; the step's URL carries only the invite code.

type Navigation = { replace: (href: string) => void };

async function storeVerificationAddress(email: string): Promise<boolean> {
  try {
    const response = await fetch('/auth/verify-address', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Leaves the address for the code step and opens it; the caller refreshes the
 * route cache, which still holds the signed-out pages. False when the address
 * could not be left: the caller then shows the failure instead of a code step
 * that would send the person back to the signup.
 */
export async function openVerificationStep(
  router: Navigation,
  email: string,
  inviteCode: string,
): Promise<boolean> {
  if (!(await storeVerificationAddress(email))) return false;
  router.replace(inviteCode ? `/verify?invite_code=${encodeURIComponent(inviteCode)}` : '/verify');
  return true;
}
