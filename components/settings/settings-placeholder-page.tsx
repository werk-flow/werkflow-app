import { SettingsPlaceholder } from '@/components/settings/settings-placeholder';
import { getSettingsSectionBySlug } from '@/lib/settings/sections';

type SettingsPlaceholderPageProps = {
  slug: string;
};

export function SettingsPlaceholderPage({ slug }: SettingsPlaceholderPageProps) {
  const section = getSettingsSectionBySlug(slug);

  if (!section) {
    return null;
  }

  return (
    <SettingsPlaceholder
      title={section.label}
      description={section.description}
    />
  );
}
