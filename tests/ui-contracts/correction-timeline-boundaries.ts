// The planned-visit read of a forgotten day's timeline, held until the spec
// answers it, so a contract can act while the read for a new person runs.
import type { PlannedCorrectionVisit } from '@/lib/time-corrections/types';

export type PlannedVisitsAnswer =
  | { success: true; visits: PlannedCorrectionVisit[] }
  | { success: false; error: string };

type PlannedVisitsState = {
  /** Every read the timeline issued, in order, with its input. */
  calls: unknown[];
  /** Answers the oldest open read. */
  answers: Array<(answer: PlannedVisitsAnswer) => void>;
};

declare global {
  interface Window {
    uiContractPlannedVisits: PlannedVisitsState;
  }
}

window.uiContractPlannedVisits = { calls: [], answers: [] };

export function readPlannedVisitsContract(input: unknown): Promise<PlannedVisitsAnswer> {
  window.uiContractPlannedVisits.calls.push(input);
  return new Promise((resolve) => window.uiContractPlannedVisits.answers.push(resolve));
}
