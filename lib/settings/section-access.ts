import 'server-only';

import { redirect } from 'next/navigation';

import { resolvePageMembership } from '@/lib/org/page-context';
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
  const { user, membership } = await resolvePageMembership();
  if (!membership) redirect('/dashboard');

  const section = getSettingsSectionBySlug(slug);
  if (!section || !isSettingsSectionOpenTo(section, membership.role)) {
    redirect(getSettingsHref(DEFAULT_SETTINGS_SECTION_SLUG));
  }
  return { userId: user.id, membership };
}
