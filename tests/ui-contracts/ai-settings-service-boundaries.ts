// Isolated stand-in for `@/lib/ai/settings-actions`: the WerkFlow KI card
// reads this switch as route props, a switch waits in the write gate until the
// spec answers it, and the route render its response carries waits until the
// spec releases it.
import type { AiOrganizationSwitch } from '@/lib/ai/settings';
import type { SetAiEnabledResult } from '@/lib/ai/settings-actions';
import { holdWrite } from './held-write-boundary';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

declare global {
  interface Window {
    uiContractAiSwitch: AiOrganizationSwitch;
    /** Delivers the held route render; null while none waits. */
    uiContractAiReleaseRefresh: (() => void) | null;
  }
}

window.uiContractAiSwitch = { released: true, enabled: false, updatedAt: null };
window.uiContractAiReleaseRefresh = null;

let stamp = 0;

/** The real action revalidates, so its response renders the route; the stub holds that render. */
export async function setAiEnabled(input: {
  organizationId: string;
  enabled: boolean;
}): Promise<SetAiEnabledResult> {
  const refusal = await holdWrite('set-ai-enabled', input);
  if (refusal === 'update_failed') return { success: false, error: 'update_failed' };
  if (refusal !== null) throw new Error(`Unknown refusal ${refusal}`);
  stamp += 1;
  const updatedAt = `2026-11-23T10:00:0${stamp}.000000+00:00`;
  window.uiContractAiSwitch = { released: true, enabled: input.enabled, updatedAt };
  window.uiContractAiReleaseRefresh = () => {
    window.uiContractAiReleaseRefresh = null;
    window.dispatchEvent(new Event(ROUTE_REFRESH_EVENT));
  };
  return { success: true, enabled: input.enabled, id: 'contract-ai-switch', updatedAt };
}
