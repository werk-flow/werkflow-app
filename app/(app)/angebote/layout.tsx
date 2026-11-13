import type { ReactNode } from 'react';

import { AreaNav, type AreaNavItem } from '@/components/shared/area-nav';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';

const ANGEBOTE_NAV_ITEMS: readonly AreaNavItem[] = [{ href: '/angebote/leistungen', label: 'Leistungen' }];

// The area owns the page column, the h1 and the route tabs, so subpages and
// their loading states render content only and the header never re-mounts.
export default function AngeboteLayout({ children }: { children: ReactNode }) {
  return (
    <PageShell>
      <PageHeader
        title="Angebote"
        nav={<AreaNav items={ANGEBOTE_NAV_ITEMS} ariaLabel="Angebotsbereiche" />}
      />
      <PageBody>{children}</PageBody>
    </PageShell>
  );
}
