'use client';

import { beginSessionEnd, endSessionEnd } from '@/lib/field-sync/device/today-wipe';
import { logError } from '@/lib/logging';

// What every sign-out and the organization switch ask before they end the
// session (decision record 0010, "Device data"): unsent work is the person's
// work, so a session never ends over it silently. The flows import this file
// statically, and the menu sign-out sits in a chunk every page loads at
// start, so it holds only the load of the check. The check itself, its
// sources and its dialog load when a flow asks.

const CHECK_FAILED =
  'Wir konnten nicht prüfen, ob auf diesem Gerät noch etwas nicht übertragen ist. Lade die Seite neu und versuche es dann erneut.';

type ShowBanner = (banner: {
  variant: 'error';
  message: string;
  actionLabel: string;
  onAction: () => void;
}) => unknown;

/**
 * Whether the session may end: nothing on the device is unsent any more, or the person chose to
 * discard what is. When the check cannot load or run, as in a tab left open across a deployment,
 * `showFailure` gets the sentence that says so and the session stays: a reload brings the current code.
 */
async function sessionMayEnd(
  showFailure: (message: string) => void,
  scope: 'session' | 'organization',
): Promise<boolean> {
  try {
    const { settleUnsentWork } = await import('./unsent-work-prompt');
    return await settleUnsentWork(scope);
  } catch (error) {
    logError('unsent work: the check before the session ends failed', error);
    showFailure(CHECK_FAILED);
    return false;
  }
}

/**
 * Ends the session through `end` once the check allows it, and answers whether `end` ran. From the
 * check until `end` finished or failed, this flow's barrier keeps every tab from keeping a new clock
 * action, so the check sees all the session leaves; it lifts on every exit of the flow, here.
 */
export async function endSessionAfterCheck(
  showFailure: (message: string) => void,
  end: () => Promise<unknown>,
  /** `organization` for a switch, which leaves only the active organization (unsent-work.ts, UnsentScope). */
  scope: 'session' | 'organization' = 'session',
): Promise<boolean> {
  const flow = beginSessionEnd();
  try {
    if (!(await sessionMayEnd(showFailure, scope))) return false;
    await end();
    return true;
  } finally {
    endSessionEnd(flow);
  }
}

/** The failure as an error banner whose action reloads the page. */
export function withReload(showBanner: ShowBanner): (message: string) => void {
  return (message) =>
    showBanner({
      variant: 'error',
      message,
      actionLabel: 'Neu laden',
      onAction: () => window.location.reload(),
    });
}
