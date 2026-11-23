// Isolated stand-in for `@/lib/ai/settings-actions` and the card's router: the
// WerkFlow KI card reads this switch as route props, and a switch waits in the
// write gate until the spec answers it. A route refresh re-reads the switch.
import type { AiOrganizationSwitch } from '@/lib/ai/settings';
import type { SetAiEnabledResult } from '@/lib/ai/settings-actions';
import { holdWrite } from './held-write-boundary';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

declare global {
  interface Window {
    uiContractAiSwitch: AiOrganizationSwitch;
  }
}

window.uiContractAiSwitch = { released: true, enabled: false };

export async function setAiEnabled(input: { enabled: boolean }): Promise<SetAiEnabledResult> {
  const refusal = await holdWrite('set-ai-enabled', input);
  if (refusal === 'update_failed') return { success: false, error: 'update_failed' };
  if (refusal !== null) throw new Error(`Unknown refusal ${refusal}`);
  window.uiContractAiSwitch = { released: true, enabled: input.enabled };
  return { success: true, enabled: input.enabled };
}

export function useRouter(): { refresh: () => void } {
  return { refresh: () => window.dispatchEvent(new Event(ROUTE_REFRESH_EVENT)) };
}
