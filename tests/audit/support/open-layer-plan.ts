import type { DialogOpener } from './dialog-opener';

export const DESKTOP = { width: 1280, height: 800 } as const;

/** The audited heights of the canon's widths. */
export const VIEWPORT_HEIGHT: Readonly<Record<number, number>> = {
  375: 812,
  768: 1024,
  1024: 768,
  1280: 800,
  1680: 1050,
};

type Viewport = { width: number; height: number };

/**
 * Where a dialog of the inventory opens at an audited width: at that width,
 * so the audit proves the path a user there takes, or, for a trigger declared
 * desktop-only because a phone user does not need the dialog, on the desktop
 * and then narrowed. There is no third way: a trigger that is not on screen at
 * its width fails the audit by name instead of opening silently on the desktop.
 */
export function openingPlan(
  opener: Pick<DialogOpener, 'opensOn' | 'viewport'>,
  width: number,
): { openAt: Viewport; narrowTo: Viewport | null } {
  const viewport = opener.viewport ?? { width, height: VIEWPORT_HEIGHT[width] ?? DESKTOP.height };
  const desktopFirst = opener.opensOn === 'desktop' && viewport.width < DESKTOP.width;
  return desktopFirst ? { openAt: DESKTOP, narrowTo: viewport } : { openAt: viewport, narrowTo: null };
}

/** The failure of a trigger that is not on screen where the plan opens it. */
export function offScreenTriggerMessage(width: number): string {
  return `the trigger is on screen at ${width} px; a trigger this width does not render needs the opener of the path a user there takes, or opensOn: 'desktop' with the reason a phone user does not need the dialog (phoneUse)`;
}
