import { EinstellungenContentSkeleton } from '@/components/loading-states/einstellungen-page-skeleton';

// Renders inside the (static) SettingsShell while a settings page's server
// data is awaited, so navigating between sections keeps the nav in place.
export default function SettingsLoading() {
  return <EinstellungenContentSkeleton />;
}
