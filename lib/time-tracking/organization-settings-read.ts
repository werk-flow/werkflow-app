import { getCachedOrganizationSettings } from '@/lib/data/cached';
import { logError } from '@/lib/logging';

type OrganizationSettings = Awaited<ReturnType<typeof getCachedOrganizationSettings>>;

/**
 * The organization's time-tracking settings, or null when the read failed.
 * The cached reader throws on a failed read; a caller then fails its
 * operation visibly and never computes breaks with default settings.
 */
export async function readOrganizationSettings(organizationId: string): Promise<OrganizationSettings | null> {
  try {
    return await getCachedOrganizationSettings(organizationId);
  } catch (error) {
    logError('readOrganizationSettings: organization settings read failed', error);
    return null;
  }
}
