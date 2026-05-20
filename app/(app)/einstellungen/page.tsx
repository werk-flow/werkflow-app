import { redirect } from 'next/navigation';

import { getSettingsHref, DEFAULT_SETTINGS_SECTION_SLUG } from '@/lib/settings/sections';

export default function SettingsIndexPage() {
  redirect(getSettingsHref(DEFAULT_SETTINGS_SECTION_SLUG));
}
