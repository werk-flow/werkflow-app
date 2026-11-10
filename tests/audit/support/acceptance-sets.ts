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

/** A seeded record a capture opens instead of its route's layout record (acceptance-records.ts). */
export type AcceptanceRecord =
  | 'caller-match-request'
  | 'promoted-caller-request'
  | 'office-task-backlog'
  | 'callback-overdue-request'
  | 'callback-overdue-tasks';

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
  /** Visible text scrolled to the middle of its scroll area before the image, for a change below the fold. */
  reveal?: string;
  /** Captured while the role works on the layout job; the capture clocks out afterwards. */
  clockedIn?: true;
  /** The seeded record to open instead of the route's layout record. */
  record?: AcceptanceRecord;
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

/** werk-flow/werkflow-planning#133 of 2026-10-30: the conversion dialog says where an undated job stays. */
function requestConversionCaptures(): AcceptanceSet {
  return {
    id: 'request-convert-2026-10-30',
    captures: inventoryCaptures()
      .filter((capture) => capture.view.kind === 'dialog' && capture.view.opener === 'requests.convert')
      .map((capture) => ({ ...capture, reveal: 'Geplantes Datum' })),
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

/**
 * werk-flow/werkflow-planning#167 of 2026-10-30: the proposed start date with
 * its reason, and the opening date correction of opened time accounts.
 */
function timeAccountOpeningCaptures(): AcceptanceSet {
  return {
    id: 'time-account-opening-2026-10-30',
    captures: [
      {
        id: 'admin-zeiterfassung-einstellungen',
        role: 'admin',
        route: '/zeiterfassung/einstellungen',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
        reveal: 'Zeitkonten',
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#136 of 2026-11-07: a prepared month with
 * blockers, grouped per kind with their fix, for Admin and for Büro.
 */
function periodBlockerCaptures(): AcceptanceSet {
  return {
    id: 'period-blockers-2026-11-07',
    captures: (['admin', 'buero'] as const).flatMap((role) =>
      [
        { reveal: 'Monatswerte', part: 'werte' },
        { reveal: 'Prüfhinweise', part: 'hinweise' },
      ].map(({ reveal, part }) => ({
        id: `${role}-periode-${part}`,
        role,
        route: '/zeiterfassung/perioden/[periodId]' as const,
        view: { kind: 'page' } as const,
        widths: [1280, 375] as const,
        schemes: ['light', 'dark'] as const,
        reveal,
      })),
    ),
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#138 of 2026-11-07: the clock dock clocked in on
 * the work pack and the time history, and clocked out on the period's findings.
 */
function clockDockCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'clock-dock-2026-11-07',
    captures: [
      {
        id: 'employee-auftraege-jobNumber-clocked-in',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        clockedIn: true,
        ...both,
      },
      {
        id: 'employee-zeiterfassung-tab-history-clocked-in',
        role: 'employee',
        route: '/zeiterfassung',
        view: { kind: 'tab', value: 'history' },
        clockedIn: true,
        ...both,
      },
      {
        id: 'admin-zeiterfassung-perioden-periodId',
        role: 'admin',
        route: '/zeiterfassung/perioden/[periodId]',
        view: { kind: 'page' },
        reveal: 'Prüfhinweise',
        ...both,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#156 of 2026-11-09: a leaver's open work in the
 * personnel process, the transition that names it, and its handover.
 */
function leaverHandoverCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const member = { role: 'admin', route: '/mitarbeiter/[userId]' } as const;
  return {
    id: 'leaver-handover-2026-11-09',
    captures: [
      {
        id: 'admin-mitarbeiter-userId-personalprozess',
        ...member,
        view: { kind: 'page' },
        reveal: 'Personalprozess',
        ...both,
      },
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-transition',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-transition' },
        ...both,
      },
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-handover',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-handover' },
        ...both,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#142 of 2026-11-07: an unmatched caller who is
 * already a customer, and the conversion of a promoted caller that starts with
 * the captured address as Einsatzort.
 */
function callerMatchCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'caller-match-2026-11-07',
    captures: [
      {
        id: 'buero-anfrage-treffer',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'page' },
        record: 'caller-match-request',
        ...both,
      },
      {
        id: 'buero-anfrage-umwandeln',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'dialog', opener: 'requests.convert' },
        record: 'promoted-caller-request',
        reveal: 'Ort',
        ...both,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#283 of 2026-11-07: the library rows with their
 * archive line and the „Aufbewahrung“ section of the file details.
 */
function documentRetentionCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'document-retention-2026-11-07',
    captures: [
      { id: 'admin-dokumente', role: 'admin', route: '/dokumente', view: { kind: 'page' }, ...both },
      {
        id: 'admin-dokumente-details',
        role: 'admin',
        route: '/dokumente',
        view: { kind: 'dialog', opener: 'documents.details' },
        reveal: 'Aufbewahrung',
        ...both,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#284 of 2026-11-08: the library with its search
 * placeholder and origin line, and the „Herkunft“ section of the file details.
 */
function documentOriginCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'document-origin-2026-11-08',
    captures: [
      { id: 'admin-dokumente', role: 'admin', route: '/dokumente', view: { kind: 'page' }, ...both },
      {
        id: 'buero-dokumente-details',
        role: 'buero',
        route: '/dokumente',
        view: { kind: 'dialog', opener: 'documents.details' },
        reveal: 'Herkunft',
        ...both,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#144 of 2026-11-08: Aufgaben for Büro, with the
 * time-bound decisions first and the handover backlog counted at the end.
 */
function taskOrderCaptures(): AcceptanceSet {
  return {
    id: 'task-order-2026-11-08',
    captures: [
      {
        id: 'buero-aufgaben',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'page' },
        record: 'office-task-backlog',
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'buero-aufgaben-uebergaben',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'page' },
        record: 'office-task-backlog',
        reveal: 'Alle anzeigen',
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#146 of 2026-11-08: the employee's one „Zeit
 * nachtragen“ in the Zeiterfassung header and the calendar, its form with
 * empty times, and the Verlauf without a second add action.
 */
function addTimeCaptures(): AcceptanceSet {
  const phone = { role: 'employee', widths: [375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'zeit-nachtragen-2026-11-08',
    captures: [
      { id: 'employee-zeiterfassung', route: '/zeiterfassung', view: { kind: 'page' }, ...phone },
      {
        id: 'employee-zeiterfassung-dialog-field-manual-entry',
        route: '/zeiterfassung',
        view: { kind: 'dialog', opener: 'field.manual-entry' },
        ...phone,
      },
      {
        id: 'employee-zeiterfassung-tab-history',
        route: '/zeiterfassung',
        view: { kind: 'tab', value: 'history' },
        ...phone,
      },
      { id: 'employee-kalender', route: '/kalender', view: { kind: 'page' }, ...phone },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#287 of 2026-11-08: the Admin's „Datenexport“
 * section, settled and loading, and the settings nav that leads there.
 */
function organizationExportCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'organization-export-2026-11-08',
    captures: [
      {
        id: 'admin-einstellungen-datenexport',
        role: 'admin',
        route: '/einstellungen/datenexport',
        view: { kind: 'page' },
        ...both,
      },
      {
        id: stateCaptureId('admin-einstellungen-datenexport', 'loading'),
        role: 'admin',
        route: '/einstellungen/datenexport',
        view: { kind: 'page' },
        state: 'loading',
        ...both,
      },
      {
        id: 'admin-einstellungen-organisation',
        role: 'admin',
        route: '/einstellungen/organisation',
        view: { kind: 'page' },
        ...both,
      },
    ],
    standalone: [],
  };
}

/** werk-flow/werkflow-planning#316 of 2026-11-09: the offline fallback the service worker serves without network. */
function offlineShellCaptures(): AcceptanceSet {
  return {
    id: 'offline-shell-2026-11-09',
    captures: [],
    standalone: [
      { id: 'standalone-offline', screen: '/offline', widths: [1280, 375], schemes: ['light', 'dark'] },
    ],
  };
}

/**
 * werk-flow/werkflow-planning#334 of 2026-11-09: „Problem melden“ in the shell,
 * its dialog with the redrawn screenshot for the field worker and the office,
 * and „Meine Meldungen“ for each role, empty and loading.
 */
function problemReportCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'problem-reports-2026-11-09',
    captures: [
      { id: 'admin-dashboard', role: 'admin', route: '/dashboard', view: page, ...both },
      ...(['admin', 'buero', 'employee'] as const).map(
        (role): CaptureSpec => ({ id: `${role}-meldungen`, role, route: '/meldungen', view: page, ...both }),
      ),
      {
        id: stateCaptureId('employee-meldungen', 'loading'),
        role: 'employee',
        route: '/meldungen',
        view: page,
        state: 'loading',
        ...both,
      },
      {
        id: 'employee-dashboard-dialog-field-problem-report',
        role: 'employee',
        route: '/dashboard',
        view: { kind: 'dialog', opener: 'field.problem-report' },
        ...both,
      },
      {
        id: 'buero-auftraege-dialog-shell-problem-report',
        role: 'buero',
        route: '/auftraege',
        view: { kind: 'dialog', opener: 'shell.problem-report' },
        ...both,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#322 of 2026-11-09: capture with „Rückruf bis“,
 * an emergency request whose callback is overdue with the Notfall notice and a
 * site without Anlagen, and the overdue callback in the Büro's Aufgaben.
 */
function requestCallbackCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'request-callback-2026-11-09',
    captures: [
      {
        id: 'buero-anfrage-erfassen',
        role: 'buero',
        route: '/anfragen',
        view: { kind: 'dialog', opener: 'requests.create' },
        reveal: 'Rückruf bis',
        ...both,
      },
      {
        id: 'buero-anfrage-rueckruf',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'page' },
        record: 'callback-overdue-request',
        ...both,
      },
      {
        id: 'buero-anfrage-bearbeiten',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'dialog', opener: 'requests.edit' },
        record: 'callback-overdue-request',
        reveal: 'An diesem Einsatzort ist keine Anlage erfasst.',
        ...both,
      },
      {
        id: 'buero-aufgaben-rueckruf',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'page' },
        record: 'callback-overdue-tasks',
        ...both,
      },
    ],
    standalone: [],
  };
}

export const ACCEPTANCE_SETS: readonly AcceptanceSet[] = [
  uiRoundCaptures(),
  fieldTargetCaptures(),
  stateCaptures(),
  employeeProjectionCaptures(),
  organizationDeletionCaptures(),
  requestConversionCaptures(),
  settingsRoleCaptures(),
  timeAccountOpeningCaptures(),
  periodBlockerCaptures(),
  clockDockCaptures(),
  callerMatchCaptures(),
  documentRetentionCaptures(),
  documentOriginCaptures(),
  taskOrderCaptures(),
  addTimeCaptures(),
  organizationExportCaptures(),
  problemReportCaptures(),
  offlineShellCaptures(),
  requestCallbackCaptures(),
  leaverHandoverCaptures(),
];
