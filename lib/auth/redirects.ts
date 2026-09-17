import {
  getCachedMemberships,
  getCachedPrestartMemberships,
} from '@/lib/data/cached';

const DEFAULT_AUTHENTICATED_PATH = '/dashboard';
const ONBOARDING_START_PATH = '/onboarding/start';
const PERSONNEL_PRESTART_PATH = '/onboarding/meine-aufgaben';

export async function getAuthenticatedRedirectPath(userId: string): Promise<string> {
  const memberships = await getCachedMemberships(userId);
  if (memberships.length > 0) return DEFAULT_AUTHENTICATED_PATH;

  const prestartMemberships = await getCachedPrestartMemberships(userId);

  return prestartMemberships.length > 0
    ? PERSONNEL_PRESTART_PATH
    : ONBOARDING_START_PATH;
}
