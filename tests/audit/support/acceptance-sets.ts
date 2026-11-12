import type { InventoriedRoute } from '../../../lib/testing/selection/mobile-route-inventory';
import {
  inventoryCaptures,
  slug,
  type AcceptanceSet as CaptureSet,
  type CaptureSpec,
} from './acceptance-rounds';
import { stateCaptureId } from './acceptance-state-plan';

/**
 * The open sets of rendered acceptance (docs/technical/standards-audit.md,
 * "Rendered design acceptance"): the screens a change shows the owner, captured by the
 * focused run `bun run test:audit:focused --grep "@ACCEPT <set>"` with the
 * fixture that owns login and readiness. A set stays here while the record or
 * the owner review that cites it is open; delete it when that closes (the
 * images stay in their run directory). Together they are the group
 * `audit:visual:acceptance:sets`; the rounds over the whole inventory live in
 * acceptance-rounds.ts.
 */

/** A seeded record a capture opens instead of its route's layout record (acceptance-records.ts). */
export type AcceptanceRecord =
  | 'caller-match-request'
  | 'promoted-caller-request'
  | 'office-task-backlog'
  | 'archived-customer'
  | 'archived-customer-list'
  | 'callback-overdue-request'
  | 'callback-overdue-tasks'
  | 'employee-activity-history'
  | 'employee-activity-job'
  | 'attachable-request'
  | 'request-without-open-work'
  | 'attached-request'
  | 'job-with-attached-request';

/** A set whose captures may open a seeded record instead of their route's layout record. */
type AcceptanceSet = CaptureSet<CaptureSpec & { record?: AcceptanceRecord }>;

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
 * werk-flow/werkflow-planning#325 of 2026-11-09: the list's view select, the
 * archive and delete dialogs, the archived customer list, and an archived
 * customer's notice and master-data entries in the chronology.
 */
function customerArchiveCaptures(): AcceptanceSet {
  const both = { role: 'buero', widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'customer-archive-2026-11-09',
    captures: [
      { id: 'buero-kunden', route: '/kunden', view: { kind: 'page' }, ...both },
      {
        id: 'buero-kunden-dialog-customers-list-archive',
        route: '/kunden',
        view: { kind: 'dialog', opener: 'customers.list-archive' },
        ...both,
      },
      {
        id: 'buero-kunden-clientId-dialog-customers-delete',
        route: '/kunden/[clientId]',
        view: { kind: 'dialog', opener: 'customers.delete' },
        ...both,
      },
      {
        id: 'buero-kunden-archiviert',
        route: '/kunden',
        view: { kind: 'page' },
        record: 'archived-customer-list',
        ...both,
      },
      {
        id: 'buero-kunde-archiviert',
        route: '/kunden/[clientId]',
        view: { kind: 'page' },
        record: 'archived-customer',
        ...both,
      },
      {
        id: 'buero-kunde-archiviert-verlauf',
        route: '/kunden/[clientId]',
        view: { kind: 'page' },
        record: 'archived-customer',
        reveal: 'Stammdaten geändert',
        ...both,
      },
    ],
    standalone: [],
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
        id: 'employee-dashboard-dialog-reports-field',
        role: 'employee',
        route: '/dashboard',
        view: { kind: 'dialog', opener: 'reports.field' },
        ...both,
      },
      {
        id: 'buero-auftraege-dialog-reports-office',
        role: 'buero',
        route: '/auftraege',
        view: { kind: 'dialog', opener: 'reports.office' },
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

/**
 * werk-flow/werkflow-planning#158 of 2026-11-10: recorded time as activities.
 * The employee's Verlauf as days with one row per activity, and the work
 * pack's „Meine Zeit“ with each time's span and duration, from a legacy day
 * whose clock-out names no job, a tap shorter than a minute and a clock-in
 * without its clock-out.
 */
function activityHistoryCaptures(): AcceptanceSet {
  const phone = { role: 'employee', widths: [375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'activity-history-2026-11-10',
    captures: [
      {
        id: 'employee-zeiterfassung-tab-history',
        route: '/zeiterfassung',
        view: { kind: 'tab', value: 'history' },
        record: 'employee-activity-history',
        reveal: 'Ende fehlt',
        role: 'employee',
        widths: [375, 1280],
        schemes: ['light', 'dark'],
      },
      {
        id: 'employee-auftraege-jobNumber',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        record: 'employee-activity-job',
        reveal: 'Aktivität wählen',
        ...phone,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#328 of 2026-11-09: the request detail with
 * „Zu Arbeit hinzufügen“, the attach dialog with and without open work, the
 * attached request, and its entry in the job's „Hinzugefügte Anfragen“.
 */
function requestAttachCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const request = { role: 'buero', route: '/anfragen/[requestId]' } as const;
  const attachDialog = { kind: 'dialog', opener: 'requests.attach-to-work' } as const;
  return {
    id: 'request-attach-2026-11-09',
    captures: [
      {
        id: 'buero-anfrage-offen',
        ...request,
        view: { kind: 'page' },
        record: 'attachable-request',
        ...both,
      },
      {
        id: 'buero-anfrage-hinzufuegen',
        ...request,
        view: attachDialog,
        record: 'attachable-request',
        ...both,
      },
      {
        id: 'buero-anfrage-hinzufuegen-leer',
        ...request,
        view: attachDialog,
        record: 'request-without-open-work',
        ...both,
      },
      {
        id: 'buero-anfrage-hinzugefuegt',
        ...request,
        view: { kind: 'page' },
        record: 'attached-request',
        ...both,
      },
      {
        id: 'buero-auftrag-hinzugefuegte-anfrage',
        role: 'buero',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        record: 'job-with-attached-request',
        reveal: 'Hinzugefügte Anfragen',
        ...both,
      },
    ],
    standalone: [],
  };
}

/**
 * werk-flow/werkflow-planning#159 of 2026-11-10: the access and employment
 * dialogs offer only the steps that fit, each with its effect, and the
 * member list's login chips.
 */
function lifecycleStepCaptures(): AcceptanceSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const member = { role: 'admin', route: '/mitarbeiter/[userId]' } as const;
  return {
    id: 'lifecycle-steps-2026-11-10',
    captures: [
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-access',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-access' },
        ...both,
      },
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-transition',
        ...member,
        view: { kind: 'dialog', opener: 'people.lifecycle-transition' },
        ...both,
      },
      { id: 'admin-mitarbeiter', role: 'admin', route: '/mitarbeiter', view: { kind: 'page' }, ...both },
    ],
    standalone: [],
  };
}

export const ACCEPTANCE_SETS: readonly AcceptanceSet[] = [
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
  customerArchiveCaptures(),
  offlineShellCaptures(),
  requestCallbackCaptures(),
  leaverHandoverCaptures(),
  activityHistoryCaptures(),
  requestAttachCaptures(),
  lifecycleStepCaptures(),
];
