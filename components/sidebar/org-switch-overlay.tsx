'use client';

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { useOrganization } from '@/components/organization/organization-context';
import { DashboardPageSkeleton } from '@/components/loading-states/dashboard-page-skeleton';
import { MitarbeiterPageSkeleton } from '@/components/loading-states/mitarbeiter-page-skeleton';
import { KalenderPageSkeleton } from '@/components/loading-states/kalender-page-skeleton';
import { AreaPageSkeleton } from '@/components/loading-states/area-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageShell } from '@/components/shared/page-shell';
import { ZeiterfassungOverviewSkeleton } from '@/components/loading-states/zeiterfassung-content-skeleton';
import {
  TimeAccountSettingsSkeleton,
  TimeAccountSkeleton,
  TimePeriodsSkeleton,
} from '@/components/loading-states/zeiterfassung-time-account-skeletons';
import { MaintenancePageSkeleton } from '@/components/loading-states/maintenance-page-skeleton';
import { OnCallWeekSkeleton } from '@/components/loading-states/on-call-skeletons';
import { KundenPageSkeleton } from '@/components/loading-states/kunden-page-skeleton';
import { AuftraegePageSkeleton } from '@/components/loading-states/auftraege-page-skeleton';
import { DokumentePageSkeleton } from '@/components/loading-states/dokumente-page-skeleton';
import { InventarPageSkeleton } from '@/components/loading-states/inventar-page-skeleton';
import { AufgabenPageSkeleton } from '@/components/loading-states/aufgaben-page-skeleton';
import { AnfragenPageSkeleton } from '@/components/loading-states/anfragen-page-skeleton';
import { QualifikationenPageSkeleton } from '@/components/loading-states/qualifikationen-page-skeleton';
import { MeldungenPageSkeleton } from '@/components/loading-states/meldungen-page-skeleton';
import { EinstellungenPageSkeleton } from '@/components/loading-states/einstellungen-page-skeleton';
import { WorkTemplatesPageSkeleton } from '@/components/loading-states/work-templates-page-skeleton';
import { EquipmentPageSkeleton } from '@/components/loading-states/equipment-page-skeleton';
import { ServiceCasesPageSkeleton } from '@/components/loading-states/service-cases-page-skeleton';

// The skeleton of the page the user lands on after an organization switch.
// A record's detail page belongs to the organization being left, so it maps to
// its list (the switch navigates there); an area subpage keeps its own content
// skeleton inside the area header. The first matching prefix wins, so a
// subpage sits above its area.
const ORG_SWITCH_SKELETONS: ReadonlyArray<
  readonly [prefix: string, skeleton: (lazy: LazySkeletons) => ReactElement]
> = [
  ['/mitarbeiter', () => <MitarbeiterPageSkeleton />],
  ['/aufgaben', () => <AufgabenPageSkeleton />],
  ['/dashboard', () => <DashboardPageSkeleton />],
  ['/kalender', () => <KalenderPageSkeleton />],
  [
    '/zeiterfassung/zeitkonto',
    () => (
      <ZeiterfassungAreaSkeleton>
        <TimeAccountSkeleton />
      </ZeiterfassungAreaSkeleton>
    ),
  ],
  [
    '/zeiterfassung/perioden',
    () => (
      <ZeiterfassungAreaSkeleton>
        <TimePeriodsSkeleton />
      </ZeiterfassungAreaSkeleton>
    ),
  ],
  [
    '/zeiterfassung/einstellungen',
    () => (
      <ZeiterfassungAreaSkeleton>
        <TimeAccountSettingsSkeleton />
      </ZeiterfassungAreaSkeleton>
    ),
  ],
  [
    '/zeiterfassung',
    () => (
      <ZeiterfassungAreaSkeleton>
        <ZeiterfassungOverviewSkeleton />
      </ZeiterfassungAreaSkeleton>
    ),
  ],
  ['/kunden', () => <KundenPageSkeleton />],
  ['/auftraege', () => <AuftraegePageSkeleton />],
  ['/dokumente', () => <DokumentePageSkeleton />],
  [
    '/service/wartung',
    () => (
      <ServiceAreaSkeleton>
        <MaintenancePageSkeleton />
      </ServiceAreaSkeleton>
    ),
  ],
  [
    '/service/bereitschaft',
    () => (
      <ServiceAreaSkeleton>
        <OnCallWeekSkeleton />
      </ServiceAreaSkeleton>
    ),
  ],
  [
    '/service/anlagen',
    () => (
      <ServiceAreaSkeleton>
        <EquipmentPageSkeleton />
      </ServiceAreaSkeleton>
    ),
  ],
  [
    '/service',
    () => (
      <ServiceAreaSkeleton>
        <ServiceCasesPageSkeleton />
      </ServiceAreaSkeleton>
    ),
  ],
  ['/anfragen', () => <AnfragenPageSkeleton />],
  ['/qualifikationen', () => <QualifikationenPageSkeleton />],
  ['/meldungen', () => <MeldungenPageSkeleton />],
  ['/arbeitsvorlagen', () => <WorkTemplatesPageSkeleton />],
  ['/einstellungen', () => <EinstellungenPageSkeleton />],
  ['/inventar', () => <InventarPageSkeleton />],
  [
    '/angebote/leistungen',
    ({ angebote }) => (
      <AreaPageSkeleton title="Angebote" tabCount={2}>
        {angebote && <angebote.LeistungenPageSkeleton />}
      </AreaPageSkeleton>
    ),
  ],
  [
    '/angebote',
    ({ angebote }) => (
      <AreaPageSkeleton title="Angebote" tabCount={2}>
        {angebote && <angebote.OffersPageSkeleton />}
      </AreaPageSkeleton>
    ),
  ],
  [
    '/rechnungen',
    ({ rechnungen }) =>
      rechnungen ? (
        <rechnungen.InvoicesPageSkeleton />
      ) : (
        <PageShell>
          <PageHeader title="Rechnungen" />
        </PageShell>
      ),
  ],
];

function ZeiterfassungAreaSkeleton({ children }: { children: ReactNode }) {
  return (
    <AreaPageSkeleton title="Zeiterfassung" tabCount={4}>
      {children}
    </AreaPageSkeleton>
  );
}

function ServiceAreaSkeleton({ children }: { children: ReactNode }) {
  return (
    <AreaPageSkeleton title="Service" tabCount={3}>
      {children}
    </AreaPageSkeleton>
  );
}

function inArea(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function orgSwitchSkeleton(pathname: string, lazy: LazySkeletons): ReactElement | null {
  const match = ORG_SWITCH_SKELETONS.find(([prefix]) => inArea(pathname, prefix));
  return match ? match[1](lazy) : null;
}

type AngeboteSkeletons = typeof import('@/components/angebote/area-skeletons');
type RechnungenSkeletons = typeof import('@/components/rechnungen/invoices-skeleton');
type LazySkeletons = { angebote: AngeboteSkeletons | null; rechnungen: RechnungenSkeletons | null };

const loadAngebote = () => import('@/components/angebote/area-skeletons');
const loadRechnungen = () => import('@/components/rechnungen/invoices-skeleton');

// Only the office opens Angebote and Rechnungen, so an area's content skeletons load once the
// user is in it and no field worker's start-up carries them. Until they arrive, or when the load
// failed (as without signal), a switch shows the area's title (and tabs); each switch start tries
// again.
function useAreaSkeletons<Skeletons>(
  inThisArea: boolean,
  isSwitchingOrg: boolean,
  load: () => Promise<Skeletons>,
): Skeletons | null {
  const [skeletons, setSkeletons] = useState<Skeletons | null>(null);
  useEffect(() => {
    if (!inThisArea || skeletons) return;
    let current = true;
    load().then(
      (loaded) => {
        if (current) setSkeletons(loaded);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [inThisArea, isSwitchingOrg, skeletons, load]);
  return skeletons;
}

// Org-switching skeleton overlay (isolated so AppShell stays data-free)
export function OrgSwitchOverlay() {
  const { isSwitchingOrg } = useOrganization();
  const pathname = usePathname();
  const angebote = useAreaSkeletons(inArea(pathname, '/angebote'), isSwitchingOrg, loadAngebote);
  const rechnungen = useAreaSkeletons(inArea(pathname, '/rechnungen'), isSwitchingOrg, loadRechnungen);

  const currentSkeleton = useMemo(
    () => orgSwitchSkeleton(pathname, { angebote, rechnungen }),
    [pathname, angebote, rechnungen],
  );

  if (!isSwitchingOrg || !currentSkeleton) return null;

  return <div className="absolute inset-0 z-50 overflow-y-auto bg-background">{currentSkeleton}</div>;
}
