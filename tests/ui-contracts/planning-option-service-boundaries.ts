import { planningOptionRequestSchema } from '@/lib/planning/option-types';
import type {
  PlanningOption,
  PlanningOptionRequest,
  PlanningOptionResult,
} from '@/lib/planning/option-types';

declare global {
  interface Window {
    planningOptionContract: {
      defaults: string[];
      requests: Array<PlanningOptionRequest & { signal?: AbortSignal }>;
      resolve: (
        index: number,
        options: PlanningOption[],
        selected?: PlanningOption[],
        hasMore?: boolean,
      ) => void;
      reject: (index: number) => void;
    };
  }
}
const pending = new Map<number, (result: PlanningOptionResult) => void>();
window.planningOptionContract = {
  defaults: [],
  requests: [],
  resolve(index, options, selected = [], hasMore = false) {
    const settle = pending.get(index);
    if (!settle) throw new Error(`Missing planning request ${index}`);
    pending.delete(index);
    settle({ success: true, options, selected, hasMore });
  },
  reject(index) {
    const settle = pending.get(index);
    if (!settle) throw new Error(`Missing planning request ${index}`);
    pending.delete(index);
    settle({ success: false, error: 'load_failed' });
  },
};
// Deliberately permit late resolution after abort, to test the hook's rejection of obsolete responses.
export function readPlanningOptionContract(
  input: unknown,
  signal?: AbortSignal,
): Promise<PlanningOptionResult> {
  const index =
    window.planningOptionContract.requests.push({
      ...planningOptionRequestSchema.parse(input),
      ...(signal ? { signal } : {}),
    }) - 1;
  return new Promise((resolve) => pending.set(index, resolve));
}
