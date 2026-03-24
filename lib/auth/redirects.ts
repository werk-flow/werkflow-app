import { getCachedMemberships } from '@/lib/data/cached';

export const DEFAULT_AUTHENTICATED_PATH = '/dashboard';
export const ONBOARDING_START_PATH = '/onboarding/start';

export async function getAuthenticatedRedirectPath(userId: string) {
  const memberships = await getCachedMemberships(userId);

  return memberships.length > 0
    ? DEFAULT_AUTHENTICATED_PATH
    : ONBOARDING_START_PATH;
}
