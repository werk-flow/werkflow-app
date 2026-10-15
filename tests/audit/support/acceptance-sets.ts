import type { DialogOpenerId } from '../../../lib/testing/selection/dialog-inventory';
import type { InventoriedRoute, SurfaceRole } from '../../../lib/testing/selection/mobile-route-inventory';
import { SURFACE_GROUPS, surfaceTargets } from '../../../lib/testing/selection/surface-groups';

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
  role: SurfaceRole;
  route: InventoriedRoute;
  view: CaptureView;
  widths: readonly (375 | 768 | 1024 | 1280 | 1680)[];
  schemes: readonly ('light' | 'dark')[];
};

export type AcceptanceSet = { id: string; captures: readonly CaptureSpec[] };

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

export const ACCEPTANCE_SETS: readonly AcceptanceSet[] = [
  { id: 'rendered-2026-10', captures: inventoryCaptures() },
];
