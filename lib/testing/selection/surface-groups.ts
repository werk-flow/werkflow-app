import { dialogAuditTargets, type DialogAuditTarget } from './dialog-inventory';
import {
  DYNAMIC_PHONE_ROUTES,
  EMPLOYEE_PHONE_ROUTES,
  EMPLOYEE_WORK_PACKS,
  MANAGER_PHONE_ROUTES,
  type InventoriedRoute,
  type SurfaceRole,
} from './mobile-route-inventory';
import { PAGE_TAB_SETS } from './page-tab-inventory';

/**
 * The audit groups that open every page of the route inventory with its tabs
 * and dialogs, one spec file each (`audit:layout:<group>`,
 * `tests/audit/layout/surfaces-<group>.spec.ts`). A group holds the pages of
 * one product area, so a change in that area selects it through its scopes;
 * the field worker's pages form their own groups. Each group stays within the
 * four-minute bound of the spec checklist in docs/technical/testing.md: a page
 * with many dialogs spreads its test parts over several groups (`PART_GROUPS`).
 */
export const SURFACE_GROUPS = [
  'work',
  'job',
  'job-actions',
  'job-lifecycle',
  'requests',
  'templates',
  'customers',
  'planning',
  'planning-board',
  'time',
  'people',
  'personnel',
  'personnel-absence',
  'settings',
  'documents',
  'inventory',
  'service',
  'field',
  'field-time',
] as const;
export type SurfaceGroup = (typeof SURFACE_GROUPS)[number];

type FieldGroup = 'field' | 'field-time';

/** The manager pages by group. A `Record` over the inventory, so a new page needs a group to compile. */
const MANAGER_GROUPS: Readonly<Record<InventoriedRoute, Exclude<SurfaceGroup, FieldGroup>>> = {
  '/dashboard': 'settings',
  '/aufgaben': 'settings',
  '/kalender': 'planning',
  '/zeiterfassung': 'time',
  '/zeiterfassung/zeitkonto': 'time',
  '/zeiterfassung/perioden': 'time',
  '/zeiterfassung/einstellungen': 'time',
  '/zeiterfassung/perioden/[periodId]': 'time',
  '/qualifikationen': 'people',
  '/anfragen': 'requests',
  '/anfragen/[requestId]': 'requests',
  '/arbeitsvorlagen': 'templates',
  '/auftraege': 'work',
  '/auftraege/projekt/[projectNumber]': 'work',
  '/auftraege/projekt/[projectNumber]/uebergabe': 'work',
  '/auftraege/uebergaben/[targetType]/[targetId]': 'work',
  '/auftraege/[jobNumber]': 'job',
  '/auftraege/[jobNumber]/uebergabe': 'job',
  '/auftraege/projekt/[projectNumber]/[jobNumber]': 'job',
  '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe': 'job',
  '/kunden': 'customers',
  '/kunden/[clientId]': 'customers',
  '/mitarbeiter': 'people',
  '/mitarbeiter/[userId]': 'personnel',
  '/dokumente': 'documents',
  '/inventar': 'inventory',
  '/service/faelle': 'service',
  '/service/anlagen': 'service',
  '/service/wartung': 'service',
  '/service/anlagen/[equipmentNumber]': 'service',
  '/service/faelle/[caseNumber]': 'service',
  '/einstellungen/profil': 'settings',
  '/einstellungen/zeiterfassung': 'settings',
  '/einstellungen/kunden': 'settings',
  '/einstellungen/dashboard': 'settings',
  '/einstellungen/kalender': 'settings',
  '/einstellungen/konto-sicherheit': 'settings',
  '/einstellungen/organisation': 'settings',
  '/einstellungen/abonnement-abrechnung': 'settings',
  '/einstellungen/mitarbeiter': 'settings',
  '/einstellungen/auftraege-projekte': 'settings',
};

/**
 * The groups that run the test parts of a manager page with many dialogs, one
 * entry per part in order (`surfaceTests` splits a page's dialogs into parts).
 * The first part holds the default view and the tabs, so its group owns the page.
 */
const PART_GROUPS: Readonly<Partial<Record<InventoriedRoute, readonly SurfaceGroup[]>>> = {
  '/auftraege/[jobNumber]': ['job', 'job-actions', 'job-lifecycle'],
  '/kalender': ['planning', 'planning-board'],
  '/mitarbeiter/[userId]': ['personnel', 'personnel-absence'],
};

/** The field worker's pages by group; every other employee page is in `field`. */
const FIELD_GROUPS: Readonly<Partial<Record<InventoriedRoute, FieldGroup>>> = {
  '/zeiterfassung': 'field-time',
};

/** The group that owns a page for a role: it audits the default view, the tabs and the first part. */
function surfaceGroupOf(route: InventoriedRoute, role: SurfaceRole): SurfaceGroup {
  if (role === 'employee') return FIELD_GROUPS[route] ?? 'field';
  return PART_GROUPS[route]?.[0] ?? MANAGER_GROUPS[route];
}

/** One page of a surface group with the tabs and dialogs the group opens on it. */
export type SurfaceTarget = {
  route: InventoriedRoute;
  role: SurfaceRole;
  /** The page's tabs by value; empty when the page has none. */
  tabs: readonly string[];
  dialogs: readonly DialogAuditTarget[];
};

/**
 * The pages of a group in inventory order, each with its tabs and dialogs:
 * every manager page of the route inventory for the admin, every field-worker
 * page and work pack for the employee.
 */
export function surfaceTargets(group: SurfaceGroup): SurfaceTarget[] {
  const targets = new Map<string, SurfaceTarget>();
  const pages: [InventoriedRoute, SurfaceRole][] = [
    ...[...MANAGER_PHONE_ROUTES, ...DYNAMIC_PHONE_ROUTES].map((route): [InventoriedRoute, SurfaceRole] => [
      route,
      'admin',
    ]),
    ...[...EMPLOYEE_PHONE_ROUTES, ...EMPLOYEE_WORK_PACKS].map((route): [InventoriedRoute, SurfaceRole] => [
      route,
      'employee',
    ]),
  ];
  for (const [route, role] of pages)
    if (surfaceGroupOf(route, role) === group)
      targets.set(`${role} ${route}`, { route, role, tabs: [], dialogs: [] });
  const page = (route: InventoriedRoute, role: SurfaceRole): SurfaceTarget => {
    const existing = targets.get(`${role} ${route}`);
    if (!existing) throw new Error(`${role} ${route} is not an inventoried page of its role.`);
    return existing;
  };
  for (const set of PAGE_TAB_SETS) {
    if (surfaceGroupOf(set.route, set.role) !== group) continue;
    targets.set(`${set.role} ${set.route}`, { ...page(set.route, set.role), tabs: set.tabs });
  }
  for (const dialog of dialogAuditTargets()) {
    if (surfaceGroupOf(dialog.route, dialog.role) !== group) continue;
    const owner = page(dialog.route, dialog.role);
    targets.set(`${dialog.role} ${dialog.route}`, { ...owner, dialogs: [...owner.dialogs, dialog] });
  }
  return [...targets.values()];
}

/** One browser test of a surface group: a page, and the part of its audit this test runs. */
export type SurfaceTest = {
  title: string;
  route: InventoriedRoute;
  role: SurfaceRole;
  /** The first test of a page also audits its default view and its tabs. */
  defaultView: boolean;
  tabs: readonly string[];
  dialogs: readonly DialogAuditTarget[];
};

const DIALOGS_PER_TEST = 8;

/** The group that runs one test part of a page. */
function partGroup(target: SurfaceTarget, part: number, parts: number): SurfaceGroup {
  const groups = target.role === 'admin' ? PART_GROUPS[target.route] : undefined;
  if (!groups) return surfaceGroupOf(target.route, target.role);
  const group = groups[part];
  if (groups.length !== parts || !group)
    throw new Error(
      `${target.route} has ${parts} test parts; give PART_GROUPS one group per part (it names ${groups.length}).`,
    );
  return group;
}

/**
 * The tests of a group. Each page's dialogs split into tests of at most eight,
 * so one test stays well inside the audit lane's per-test timeout; the first
 * test of a page audits its default view and its tabs as well.
 */
export function surfaceTests(group: SurfaceGroup): SurfaceTest[] {
  return SURFACE_GROUPS.flatMap((owner) => surfaceTargets(owner)).flatMap((target) => {
    const chunks: DialogAuditTarget[][] = [];
    for (let start = 0; start < target.dialogs.length; start += DIALOGS_PER_TEST)
      chunks.push(target.dialogs.slice(start, start + DIALOGS_PER_TEST));
    if (chunks.length === 0) chunks.push([]);
    return chunks.flatMap((dialogs, index): SurfaceTest[] =>
      partGroup(target, index, chunks.length) === group
        ? [
            {
              title:
                chunks.length === 1
                  ? `${target.role} ${target.route}`
                  : `${target.role} ${target.route} part ${index + 1} of ${chunks.length}`,
              route: target.route,
              role: target.role,
              defaultView: index === 0,
              tabs: index === 0 ? target.tabs : [],
              dialogs,
            },
          ]
        : [],
    );
  });
}
