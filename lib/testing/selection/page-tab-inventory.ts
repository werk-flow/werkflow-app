import type { InventoriedRoute, SurfaceRole } from './mobile-route-inventory';

/**
 * One in-page tab set (the registry `Tabs`) on an inventoried page, for one
 * role. The rendered audit opens every tab at every width and measures it like
 * the default view; `page-tab-inventory.test.ts` scans the product source and
 * fails when a `TabsTrigger` value is missing here. Tab sets inside a dialog
 * belong to the dialog's entry in `dialog-inventory.ts`.
 */
export type PageTabSet = {
  /** The component that renders the `TabsTrigger`s. */
  component: string;
  route: InventoriedRoute;
  role: SurfaceRole;
  /** Every tab by its stable `value`; the first is the default view the route audit already measures. */
  tabs: readonly string[];
};

export const PAGE_TAB_SETS = [
  {
    component: 'components/anfragen/anfragen-content.tsx',
    route: '/anfragen',
    role: 'admin',
    tabs: ['aktiv', 'umgewandelt', 'geschlossen', 'alle'],
  },
  {
    component: 'components/inventar/inventory-content.tsx',
    route: '/inventar',
    role: 'admin',
    tabs: ['all', 'locations', 'planned', 'movements'],
  },
  {
    component: 'components/kalender/calendar-view-tabs.tsx',
    route: '/kalender',
    role: 'admin',
    tabs: ['week', 'day', 'month'],
  },
  {
    component: 'components/kalender/calendar-view-tabs.tsx',
    route: '/kalender',
    role: 'employee',
    tabs: ['week', 'day', 'month'],
  },
  {
    component: 'components/mitarbeiter/mitarbeiter-tabs-bar.tsx',
    route: '/mitarbeiter',
    role: 'admin',
    tabs: ['members', 'invitations', 'teams', 'qualifications'],
  },
  {
    component: 'components/service/maintenance-content.tsx',
    route: '/service/wartung',
    role: 'admin',
    tabs: ['due', 'plans', 'coverages'],
  },
  {
    component: 'components/zeiterfassung/zeiterfassung-content.tsx',
    route: '/zeiterfassung',
    role: 'admin',
    tabs: ['overview', 'approvals', 'history'],
  },
  {
    component: 'components/zeiterfassung/zeiterfassung-content.tsx',
    route: '/zeiterfassung',
    role: 'employee',
    tabs: ['overview', 'history'],
  },
] as const satisfies readonly PageTabSet[];
