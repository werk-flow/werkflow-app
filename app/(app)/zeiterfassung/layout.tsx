import type { ReactNode } from "react";

import { AreaNav, type AreaNavItem } from "@/components/shared/area-nav";
import { PageHeader } from "@/components/shared/page-header";
import { PageBody, PageShell } from "@/components/shared/page-shell";
import { getTimeAccountAccess } from "@/lib/time-accounts/actions";

// The area header and its route tabs live here so they survive subpage
// navigation and loading states. Every tab stays inside /zeiterfassung: the
// time rules are a real subpage and the settings area only links to them
// (owner ruling 2, 2026-09-03).
export default async function ZeiterfassungLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { canManage, isAdmin, canProposeAdjustments } =
    await getTimeAccountAccess();

  const items: AreaNavItem[] = [
    { href: "/zeiterfassung", label: "Zeiterfassung", exact: true },
    { href: "/zeiterfassung/zeitkonto", label: "Zeitkonto" },
  ];
  if (canManage) {
    items.push({ href: "/zeiterfassung/perioden", label: "Perioden" });
  }
  if (isAdmin) {
    items.push({
      href: "/zeiterfassung/einstellungen",
      label: "Regeln & Export",
    });
  } else if (canProposeAdjustments) {
    items.push({ href: "/zeiterfassung/einstellungen", label: "Korrekturen" });
  }

  return (
    <PageShell>
      <PageHeader
        title="Zeiterfassung"
        nav={<AreaNav items={items} ariaLabel="Arbeitszeitmanagement" />}
      />
      <PageBody>{children}</PageBody>
    </PageShell>
  );
}
