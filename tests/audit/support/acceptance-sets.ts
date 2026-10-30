import type { DialogOpenerId } from '../../../lib/testing/selection/dialog-inventory';
import type { InventoriedRoute, SurfaceRole } from '../../../lib/testing/selection/mobile-route-inventory';
import {
  STANDALONE_SCREENS,
  type StandaloneRoute,
} from '../../../lib/testing/selection/standalone-route-inventory';
import { SURFACE_GROUPS, surfaceTargets } from '../../../lib/testing/selection/surface-groups';
import { stateCaptureId, type CaptureState } from './acceptance-state-plan';

/**
 * Rendered acceptance captures (docs/technical/standards-audit.md, "Rendered
 * design acceptance"): the screens a change shows the owner, captured by the
 * focused run `bun run test:audit:focused --grep "@ACCEPT <set>"` with the
 * fixture that owns login and readiness. A set stays here while the record or
 * the owner review that cites it is open; delete it when that closes (the
 * images stay in their run directory).
 */
type CaptureView =
  | { kind: 'page' }
  | { kind: 'tab'; value: string }
  | { kind: 'dialog'; opener: DialogOpenerId };

export type CaptureSpec = {
  /** Unique within its set; part of the image name and the citation token. */
  id: string;
  role: SurfaceRole | 'buero';
  route: InventoriedRoute;
  view: CaptureView;
  widths: readonly (375 | 768 | 1024 | 1280 | 1680)[];
  schemes: readonly ('light' | 'dark')[];
  /** A loading or error state instead of the settled screen; the id ends in it (`stateCaptureId`). */
  state?: CaptureState;
};

/** A screen outside the app shell, opened with the session its inventory entry names. */
export type StandaloneCaptureSpec = {
  id: string;
  screen: StandaloneRoute;
  widths: CaptureSpec['widths'];
  schemes: CaptureSpec['schemes'];
};

export type AcceptanceSet = {
  id: string;
  captures: readonly CaptureSpec[];
  standalone: readonly StandaloneCaptureSpec[];
};

function slug(route: string): string {
  return route.replace(/^\//, '').replace(/[[\]]/g, '').replaceAll('/', '-') || 'root';
}

/**
 * Every page, tab and dialog of the inventories at the phone and the laptop
 * width in both themes: the before and after pairs of the rendered package.
 */
function inventoryCaptures(): CaptureSpec[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return SURFACE_GROUPS.flatMap((group) =>
    surfaceTargets(group).flatMap((target): CaptureSpec[] => {
      const base = `${target.role}-${slug(target.route)}`;
      return [
        { id: base, role: target.role, route: target.route, view: { kind: 'page' }, ...both },
        ...target.tabs.map(
          (value): CaptureSpec => ({
            id: `${base}-tab-${value}`,
            role: target.role,
            route: target.route,
            view: { kind: 'tab', value },
            ...both,
          }),
        ),
        ...target.dialogs.map(
          (dialog): CaptureSpec => ({
            id: `${base}-dialog-${dialog.opener.replace('.', '-')}`,
            role: target.role,
            route: target.route,
            view: { kind: 'dialog', opener: dialog.opener },
            ...both,
          }),
        ),
      ];
    }),
  );
}

/** Detail pages whose columns follow the content width: the laptop width shows where they switch. */
const CONTENT_COLUMN_DETAILS: ReadonlySet<InventoriedRoute> = new Set<InventoriedRoute>([
  '/auftraege/[jobNumber]',
  '/auftraege/projekt/[projectNumber]',
  '/service/faelle/[caseNumber]',
  '/service/anlagen/[equipmentNumber]',
]);

/** The UI round of 2026-10-17: the inventory, the detail columns at 1024 px and every standalone screen. */
function uiRoundCaptures(): AcceptanceSet {
  return {
    id: 'ui-round-2026-10-17',
    captures: inventoryCaptures().map((capture) =>
      capture.view.kind === 'page' && CONTENT_COLUMN_DETAILS.has(capture.route)
        ? { ...capture, widths: [1280, 1024, 375] }
        : capture,
    ),
    standalone: STANDALONE_SCREENS.map(
      (screen): StandaloneCaptureSpec => ({
        id: `standalone-${slug(screen.route)}`,
        screen: screen.route,
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      }),
    ),
  };
}

/** Package D2 of 2026-10-22: the field worker's 44 px targets on the phone, the contact role field, the job form. */
function fieldTargetCaptures(): AcceptanceSet {
  const changedDialogs: ReadonlySet<string> = new Set(['customers.contact', 'work.edit-job']);
  return {
    id: 'd2-2026-10-22',
    captures: inventoryCaptures().flatMap((capture): CaptureSpec[] => {
      if (capture.role === 'employee') return [{ ...capture, widths: [375] }];
      if (capture.view.kind === 'dialog' && changedDialogs.has(capture.view.opener)) return [capture];
      return [];
    }),
    standalone: [],
  };
}

/**
 * Package S, item S3 of 2026-10-23: one state capture per way a state is
 * reached: a route's loading.tsx behind its held navigation (office and field
 * worker), a client section's failure on a page, a dialog's held and failed
 * option read.
 */
function stateCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const templates = { kind: 'dialog', opener: 'templates.apply' } as const;
  const specs: readonly Omit<CaptureSpec, 'id' | 'widths' | 'schemes'>[] = [
    { role: 'admin', route: '/auftraege', view: { kind: 'page' }, state: 'loading' },
    { role: 'employee', route: '/dashboard', view: { kind: 'page' }, state: 'loading' },
    { role: 'admin', route: '/auftraege/projekt/[projectNumber]', view: { kind: 'page' }, state: 'error' },
    { role: 'admin', route: '/auftraege/[jobNumber]', view: templates, state: 'loading' },
    { role: 'admin', route: '/auftraege/[jobNumber]', view: templates, state: 'error' },
  ];
  return {
    id: 's3-states-2026-10-23',
    captures: specs.map((spec): CaptureSpec => {
      const view = spec.view.kind === 'dialog' ? `-dialog-${spec.view.opener.replace('.', '-')}` : '';
      const base = `${spec.role}-${slug(spec.route)}${view}`;
      return { ...spec, id: spec.state ? stateCaptureId(base, spec.state) : base, ...both };
    }),
    standalone: [],
  };
}

/** The employee read projection of 2026-10-26: the field worker sees their job pages as before, and their project with only their own jobs. */
function employeeProjectionCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const routes: readonly InventoriedRoute[] = [
    '/auftraege/[jobNumber]',
    '/auftraege/projekt/[projectNumber]',
    '/auftraege/projekt/[projectNumber]/[jobNumber]',
  ];
  return {
    id: 'employee-projection-2026-10-26',
    captures: routes.map(
      (route): CaptureSpec => ({
        id: `employee-${slug(route)}`,
        role: 'employee',
        route,
        view: { kind: 'page' },
        ...both,
      }),
    ),
    standalone: [],
  };
}

/** werk-flow/werkflow-planning#85 of 2026-10-29: the organization deletion names its scope or its refusal. */
function organizationDeletionCaptures(): AcceptanceSet {
  return {
    id: 'org-delete-2026-10-29',
    captures: inventoryCaptures().filter(
      (capture) => capture.view.kind === 'dialog' && capture.view.opener === 'settings.delete-org',
    ),
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#135 of 2026-10-30: each role's settings sections,
 * the saves that stay enabled, the Zeiterfassung tab named after its page and
 * the subscription note of the create dialog.
 */
function settingsRoleCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  const specs: readonly Pick<CaptureSpec, 'role' | 'route' | 'view'>[] = [
    { role: 'admin', route: '/einstellungen/profil', view: page },
    { role: 'admin', route: '/einstellungen/organisation', view: page },
    { role: 'admin', route: '/einstellungen/mitarbeiter', view: page },
    { role: 'admin', route: '/dashboard', view: { kind: 'dialog', opener: 'settings.create-org' } },
    { role: 'buero', route: '/einstellungen/zeiterfassung', view: page },
    { role: 'buero', route: '/zeiterfassung/einstellungen', view: page },
    { role: 'employee', route: '/einstellungen/profil', view: page },
    { role: 'employee', route: '/einstellungen/mitarbeiter', view: page },
  ];
  return {
    id: 'settings-roles-2026-10-30',
    captures: specs.map(
      (spec): CaptureSpec => ({
        ...spec,
        id: `${spec.role}-${slug(spec.route)}${spec.view.kind === 'dialog' ? '-dialog-create-org' : ''}`,
        ...both,
      }),
    ),
    standalone: [],
  };
}

export const ACCEPTANCE_SETS: readonly AcceptanceSet[] = [
  uiRoundCaptures(),
  fieldTargetCaptures(),
  stateCaptures(),
  employeeProjectionCaptures(),
  organizationDeletionCaptures(),
  settingsRoleCaptures(),
];
