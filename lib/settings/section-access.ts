import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getCachedMemberships, getCachedUser } from '@/lib/data/cached';
import { CURRENT_ORG_COOKIE, selectActiveMembership } from '@/lib/org/action-context';
import type { UserOrg } from '@/lib/org/types';
import {
  DEFAULT_SETTINGS_SECTION_SLUG,
  getSettingsHref,
  getSettingsSectionBySlug,
  isSettingsSectionOpenTo,
  type SettingsSectionSlug,
} from '@/lib/settings/sections';

/**
 * The signed-in user's active membership for a settings page. A section the
 * member's role does not see sends them to the default section, so an
 * employee never gets a manager form or a read their role is refused.
 */
export async function readSettingsSectionMembership(
  slug: SettingsSectionSlug,
): Promise<{ userId: string; membership: UserOrg }> {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);
  if (!user) redirect('/login');

  const memberships = await getCachedMemberships(user.id);
  const membership = selectActiveMembership(memberships, cookieStore.get(CURRENT_ORG_COOKIE)?.value);
  if (!membership) redirect('/dashboard');

  const section = getSettingsSectionBySlug(slug);
  if (!section || !isSettingsSectionOpenTo(section, membership.role)) {
    redirect(getSettingsHref(DEFAULT_SETTINGS_SECTION_SLUG));
  }
  return { userId: user.id, membership };
}
