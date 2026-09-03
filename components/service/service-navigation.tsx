import { AreaNav, type AreaNavItem } from '@/components/shared/area-nav';

export const SERVICE_NAV_ITEMS: readonly AreaNavItem[] = [
  { href: '/service/faelle', label: 'Servicefälle' },
  { href: '/service/anlagen', label: 'Anlagen & Geräte' },
  { href: '/service/wartung', label: 'Wartung' },
];

export function ServiceNavigation() {
  return <AreaNav items={SERVICE_NAV_ITEMS} ariaLabel="Servicebereiche" />;
}
