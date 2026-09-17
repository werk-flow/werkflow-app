// Challenge authorization, expiry and attempt counts belong to the atomic
// database transition. This rule only classifies the Auth provider response.

/** Only an explicit validation/access rejection permits discarding a completion claim. */
export function isDefiniteEmailUpdateRejection(status: number | undefined): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 422;
}
