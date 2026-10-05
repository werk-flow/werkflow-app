import type { ReactNode } from 'react';

import { AreaNav, type AreaNavItem } from '@/components/shared/area-nav';
import { PageHeaderSlot, PageHeaderSlotProvider } from '@/components/shared/page-action';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { getTimeAccountAccess } from '@/lib/time-accounts/actions';

// The area header and its route tabs live here so they survive subpage
// navigation and loading states. Every tab stays inside /zeiterfassung: the
// time rules are a real subpage and the settings area only links to them
// (owner ruling 2, 2026-09-03). A subpage portals its primary action into the
// header's slot, so „Manuelle Eintragung“ sits beside the title on the
// overview only (owner decision 2026-10-03).
export default async function ZeiterfassungLayout({ children }: { children: ReactNode }) {
  const { canManage, managementReadFailed, isAdmin, canProposeAdjustments } = await getTimeAccountAccess();

  const items: AreaNavItem[] = [
    { href: '/zeiterfassung', label: 'Zeiterfassung', exact: true },
    { href: '/zeiterfassung/zeitkonto', label: 'Zeitkonto' },
  ];
  // A failed responsibility read keeps the tab: the page then shows the
  // failure with a retry and grants nothing, instead of the tab vanishing.
  if (canManage || managementReadFailed) {
    items.push({ href: '/zeiterfassung/perioden', label: 'Perioden' });
  }
  if (isAdmin) {
    items.push({
      href: '/zeiterfassung/einstellungen',
      label: 'Regeln & Export',
    });
  } else if (canProposeAdjustments) {
    items.push({ href: '/zeiterfassung/einstellungen', label: 'Korrekturen' });
  }

  return (
    <PageHeaderSlotProvider>
      <PageShell>
        <PageHeader
          title="Zeiterfassung"
          actions={<PageHeaderSlot />}
          nav={<AreaNav items={items} ariaLabel="Arbeitszeitmanagement" />}
        />
        <PageBody>{children}</PageBody>
      </PageShell>
    </PageHeaderSlotProvider>
  );
}
