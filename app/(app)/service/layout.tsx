import type { ReactNode } from "react";

import { SERVICE_NAV_ITEMS } from "@/components/service/service-navigation";
import { AreaNav } from "@/components/shared/area-nav";
import { PageHeader } from "@/components/shared/page-header";
import { PageBody, PageShell } from "@/components/shared/page-shell";

// The area owns the page column, the h1 and the route tabs, so subpages and
// their loading states render content only and the header never re-mounts.
export default function ServiceLayout({ children }: { children: ReactNode }) {
  return (
    <PageShell>
      <PageHeader
        title="Service"
        nav={<AreaNav items={SERVICE_NAV_ITEMS} ariaLabel="Servicebereiche" />}
      />
      <PageBody>{children}</PageBody>
    </PageShell>
  );
}
