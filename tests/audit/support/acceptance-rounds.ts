import type { DialogOpenerId } from '../../../lib/testing/selection/dialog-inventory';
import type { InventoriedRoute, SurfaceRole } from '../../../lib/testing/selection/mobile-route-inventory';
import {
  STANDALONE_SCREENS,
  type StandaloneRoute,
} from '../../../lib/testing/selection/standalone-route-inventory';
import { SURFACE_GROUPS, surfaceTargets } from '../../../lib/testing/selection/surface-groups';
import type { CaptureState } from './acceptance-state-plan';

/**
 * The capture types of rendered acceptance (docs/technical/standards-audit.md,
 * "Rendered design acceptance") and its inventory rounds: the sets that
 * capture the whole inventory. A round is split over the groups
 * `audit:visual:acceptance:<group>`, one spec file each
 * (`tests/audit/visual/acceptance-<group>.spec.ts`), by what a capture
 * drives, so a group imports only the dialog openers it uses and a changed
 * helper selects the groups that reach it. The open sets of single changes
 * live in acceptance-sets.ts and form the group `sets`.
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
  /** Visible text scrolled to the middle of its scroll area before the image, for a change below the fold. */
  reveal?: string;
  /** Captured while the role works on the layout job; the capture clocks out afterwards. */
  clockedIn?: true;
};

/** A screen outside the app shell, opened with the session its inventory entry names. */
export type StandaloneCaptureSpec = {
  id: string;
  screen: StandaloneRoute;
  widths: CaptureSpec['widths'];
  schemes: CaptureSpec['schemes'];
};

export type AcceptanceSet<Capture extends CaptureSpec = CaptureSpec> = {
  id: string;
  captures: readonly Capture[];
  standalone: readonly StandaloneCaptureSpec[];
};

export function slug(route: string): string {
  return route.replace(/^\//, '').replace(/[[\]]/g, '').replaceAll('/', '-') || 'root';
}

/**
 * Every page, tab and dialog of the inventories at the phone and the laptop
 * width in both themes: the before and after pairs of the rendered package.
 */
export function inventoryCaptures(): CaptureSpec[] {
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

/** The sets built from the whole inventory. A round stays while its record or owner review is open. */
export const INVENTORY_ROUNDS: readonly AcceptanceSet[] = [uiRoundCaptures(), fieldTargetCaptures()];

type OpenerPrefix = DialogOpenerId extends `${infer Prefix}.${string}` ? Prefix : never;

/**
 * The opener module (`dialog-openers/<module>.ts`) that holds the openers of
 * each id prefix. A `Record` over the prefixes, so a dialog of a new area
 * needs a module, and with it a group, to compile.
 */
const OPENER_MODULES = {
  calendar: 'calendar',
  customers: 'customers',
  shared: 'customers',
  documents: 'documents',
  inventory: 'inventory',
  people: 'people',
  // The report dialog opens from the app shell, as the clock does; a group of its own
  // would deal the visual groups into a third CI shard.
  reports: 'time',
  requests: 'requests',
  templates: 'requests',
  service: 'service',
  settings: 'settings',
  time: 'time',
  field: 'time',
  work: 'work',
} as const satisfies Record<OpenerPrefix, string>;

/** The groups whose spec imports exactly the opener module of its name. */
export const OPENER_GROUPS = [...new Set(Object.values(OPENER_MODULES))];

/** Every group of the inventory rounds: `pages` drives no opener, `standalone` opens its own sessions. */
export const ROUND_GROUPS = ['pages', ...OPENER_GROUPS, 'standalone'] as const;
export type RoundGroup = (typeof ROUND_GROUPS)[number];

/** The group that captures a page, tab or dialog of a round: its opener's module, or `pages` without one. */
function roundGroupOf(capture: CaptureSpec): RoundGroup {
  if (capture.view.kind !== 'dialog') return 'pages';
  const { opener } = capture.view;
  const owner = Object.entries(OPENER_MODULES).find(([prefix]) => opener.startsWith(`${prefix}.`));
  if (!owner) throw new Error(`No opener module holds ${opener}.`);
  return owner[1];
}

/** The captures of each inventory round that `group` owns; a round without one is left out. */
export function roundCaptures(group: RoundGroup): AcceptanceSet[] {
  return INVENTORY_ROUNDS.map((round) => ({
    id: round.id,
    captures: round.captures.filter((capture) => roundGroupOf(capture) === group),
    standalone: group === 'standalone' ? round.standalone : [],
  })).filter((set) => set.captures.length + set.standalone.length > 0);
}
