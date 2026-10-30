import { SettingsPlaceholder } from '@/components/settings/settings-placeholder';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';
import type { SettingsSectionSlug } from '@/lib/settings/sections';

type SettingsPlaceholderPageProps = {
  slug: SettingsSectionSlug;
};

/** A settings section without options yet, opened only by the roles that see it. */
export async function SettingsPlaceholderPage({ slug }: SettingsPlaceholderPageProps) {
  await readSettingsSectionMembership(slug);
  return <SettingsPlaceholder />;
}
