'use client';

import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import { usePathname } from 'next/navigation';

import { useOrganization } from '@/components/organization/organization-context';
import { AreaPageSkeleton } from '@/components/loading-states/area-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

/** Renders a skeleton; the overlay calls it, and the skeleton it returns renders as its own component. */
type Shape = () => ReactElement;

// The skeleton of the page the user lands on after an organization switch.
// A record's detail page belongs to the organization being left, so it maps to
// its list (the switch navigates there); an area subpage keeps its own content
// skeleton inside the area header. The first matching prefix wins, so a
// subpage sits above its area.
//
// Every role's start-up carries this map, so it holds only plain shapes: a page's title, or an
// area's title and tabs. A page's own skeleton (the third element) often imports its content
// module, so it loads once a switch starts: no start-up carries office code, and a new office
// route cannot re-pack the field worker's start-up (werk-flow/werkflow-app#485). Until it
// arrives, or when the load failed (as without signal), the switch shows the plain shape; each
// switch start tries again.
const ORG_SWITCH_SKELETONS: ReadonlyArray<
  readonly [prefix: string, plain: Shape, load?: () => Promise<Shape>]
> = [
  [
    '/mitarbeiter',
    titled('Mitarbeiter'),
    () =>
      import('@/components/loading-states/mitarbeiter-page-skeleton').then((m) =>
        page(m.MitarbeiterPageSkeleton),
      ),
  ],
  [
    '/aufgaben',
    titled('Aufgaben'),
    () =>
      import('@/components/loading-states/aufgaben-page-skeleton').then((m) => page(m.AufgabenPageSkeleton)),
  ],
  [
    '/dashboard',
    titled('Dashboard'),
    () =>
      import('@/components/loading-states/dashboard-page-skeleton').then((m) =>
        page(m.DashboardPageSkeleton),
      ),
  ],
  [
    '/kalender',
    titled('Kalender'),
    () =>
      import('@/components/loading-states/kalender-page-skeleton').then((m) => page(m.KalenderPageSkeleton)),
  ],
  [
    '/zeiterfassung/zeitkonto',
    zeiterfassung(),
    () =>
      import('@/components/loading-states/zeiterfassung-time-account-skeletons').then((m) =>
        zeiterfassung(m.TimeAccountSkeleton),
      ),
  ],
  [
    '/zeiterfassung/perioden',
    zeiterfassung(),
    () =>
      import('@/components/loading-states/zeiterfassung-time-account-skeletons').then((m) =>
        zeiterfassung(m.TimePeriodsSkeleton),
      ),
  ],
  [
    '/zeiterfassung/einstellungen',
    zeiterfassung(),
    () =>
      import('@/components/loading-states/zeiterfassung-time-account-skeletons').then((m) =>
        zeiterfassung(m.TimeAccountSettingsSkeleton),
      ),
  ],
  [
    '/zeiterfassung',
    zeiterfassung(),
    () =>
      import('@/components/loading-states/zeiterfassung-content-skeleton').then((m) =>
        zeiterfassung(m.ZeiterfassungOverviewSkeleton),
      ),
  ],
  [
    '/kunden',
    titled('Kunden'),
    () => import('@/components/loading-states/kunden-page-skeleton').then((m) => page(m.KundenPageSkeleton)),
  ],
  [
    '/auftraege',
    titled('Aufträge'),
    () =>
      import('@/components/loading-states/auftraege-page-skeleton').then((m) =>
        page(m.AuftraegePageSkeleton),
      ),
  ],
  [
    '/dokumente',
    titled('Dokumente'),
    () =>
      import('@/components/loading-states/dokumente-page-skeleton').then((m) =>
        page(m.DokumentePageSkeleton),
      ),
  ],
  [
    '/service/bereitschaft',
    service(),
    () => import('@/components/loading-states/on-call-skeletons').then((m) => service(m.OnCallWeekSkeleton)),
  ],
  [
    '/service/wartung',
    service(),
    () =>
      import('@/components/loading-states/maintenance-page-skeleton').then((m) =>
        service(m.MaintenancePageSkeleton),
      ),
  ],
  [
    '/service/anlagen',
    service(),
    () =>
      import('@/components/loading-states/equipment-page-skeleton').then((m) =>
        service(m.EquipmentPageSkeleton),
      ),
  ],
  [
    '/service',
    service(),
    () =>
      import('@/components/loading-states/service-cases-page-skeleton').then((m) =>
        service(m.ServiceCasesPageSkeleton),
      ),
  ],
  [
    '/anfragen',
    titled('Anfragen'),
    () =>
      import('@/components/loading-states/anfragen-page-skeleton').then((m) => page(m.AnfragenPageSkeleton)),
  ],
  [
    '/qualifikationen',
    titled('Qualifikationen'),
    () =>
      import('@/components/loading-states/qualifikationen-page-skeleton').then((m) =>
        page(m.QualifikationenPageSkeleton),
      ),
  ],
  [
    '/meldungen',
    titled('Meine Meldungen'),
    () =>
      import('@/components/loading-states/meldungen-page-skeleton').then((m) =>
        page(m.MeldungenPageSkeleton),
      ),
  ],
  [
    '/arbeitsvorlagen',
    titled('Arbeitsvorlagen'),
    () =>
      import('@/components/loading-states/work-templates-page-skeleton').then((m) =>
        page(m.WorkTemplatesPageSkeleton),
      ),
  ],
  [
    '/einstellungen',
    titled('Einstellungen'),
    () =>
      import('@/components/loading-states/einstellungen-page-skeleton').then((m) =>
        page(m.EinstellungenPageSkeleton),
      ),
  ],
  [
    '/inventar',
    titled('Inventar'),
    () =>
      import('@/components/loading-states/inventar-page-skeleton').then((m) => page(m.InventarPageSkeleton)),
  ],
  [
    '/angebote/leistungen',
    angebote(),
    () =>
      import('@/components/angebote/leistungen/leistungen-skeleton').then((m) =>
        angebote(m.LeistungenPageSkeleton),
      ),
  ],
  [
    '/angebote',
    angebote(),
    () => import('@/components/angebote/offers-skeleton').then((m) => angebote(m.OffersPageSkeleton)),
  ],
  [
    '/rechnungen',
    titled('Rechnungen'),
    () => import('@/components/rechnungen/invoices-skeleton').then((m) => page(m.InvoicesPageSkeleton)),
  ],
];

/**
 * A page's plain shape: its title over a content placeholder. The placeholder is the busy signal
 * while the page's own skeleton loads, and after a failed load until the next switch.
 */
function titled(title: string): Shape {
  return function titledShape() {
    return (
      <PageShell>
        <PageHeader title={title} />
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  };
}

/** A page's own skeleton, rendered as its own component. */
function page(Skeleton: ComponentType): Shape {
  return function pageShape() {
    return <Skeleton />;
  };
}

/** An area page's shape: the area's title and tabs, around its subpage's content skeleton once loaded, and a placeholder until then. */
function inArea(title: string, tabCount: number, Content?: ComponentType): Shape {
  return function areaShape() {
    return (
      <AreaPageSkeleton title={title} tabCount={tabCount}>
        {Content ? <Content /> : <Skeleton className="h-64 w-full" />}
      </AreaPageSkeleton>
    );
  };
}

function zeiterfassung(Content?: ComponentType): Shape {
  return inArea('Zeiterfassung', 4, Content);
}

function service(Content?: ComponentType): Shape {
  return inArea('Service', 3, Content);
}

function angebote(Content?: ComponentType): Shape {
  return inArea('Angebote', 2, Content);
}

function inPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The page's own skeleton once loaded; the load starts with a switch, and a failed one again with the next. */
function useLoadedSkeleton(
  prefix: string | undefined,
  load: (() => Promise<Shape>) | undefined,
  isSwitchingOrg: boolean,
): Shape | null {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Shape>>(() => new Map());
  useEffect(() => {
    if (!isSwitchingOrg || prefix === undefined || !load || loaded.has(prefix)) return;
    load().then(
      (shape) => setLoaded((previous) => new Map(previous).set(prefix, shape)),
      () => {},
    );
  }, [prefix, load, isSwitchingOrg, loaded]);
  return prefix === undefined ? null : (loaded.get(prefix) ?? null);
}

// Org-switching skeleton overlay (isolated so AppShell stays data-free)
export function OrgSwitchOverlay() {
  const { isSwitchingOrg } = useOrganization();
  const pathname = usePathname();
  const match = ORG_SWITCH_SKELETONS.find(([prefix]) => inPrefix(pathname, prefix));
  const loaded = useLoadedSkeleton(match?.[0], match?.[2], isSwitchingOrg);

  if (!isSwitchingOrg || !match) return null;

  const shape = loaded ?? match[1];
  return <div className="absolute inset-0 z-50 overflow-y-auto bg-background">{shape()}</div>;
}
