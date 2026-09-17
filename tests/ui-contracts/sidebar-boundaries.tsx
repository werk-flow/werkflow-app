import { useState, type ReactElement } from "react";
import { SidebarLink } from "@/components/sidebar/sidebar-link";

export function SidebarContractFixture(): ReactElement {
  const [revision, setRevision] = useState(0);
  return <main>
    <SidebarLink href="/kunden">Kunden</SidebarLink>
    <SidebarLink href="/auftraege">Aufträge</SidebarLink>
    <button onClick={() => setRevision(revision + 1)}>Ansicht aktualisieren</button>
    <output aria-label="Aktualisierungen">{revision}</output>
  </main>;
}
