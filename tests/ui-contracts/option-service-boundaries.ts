import { jobOptionRequestSchema } from '@/lib/jobs/option-types';
import type { JobEntityOption, JobOptionRequest, JobOptionResult } from '@/lib/jobs/option-types';
import { z } from '@/lib/zod';

// The fixtures send readable ids ('org-a', 'second'), so only the id format stays unchecked.
const contractRequestSchema = jobOptionRequestSchema.extend({
  organizationId: z.string(),
  selectedIds: z.array(z.string()).optional(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  siteId: z.string().optional(),
});
function isContractRequest(input: unknown): input is JobOptionRequest {
  return contractRequestSchema.safeParse(input).success;
}

const pending: Array<(result: JobOptionResult) => void> = [];
declare global {
  interface Window {
    optionContract: {
      requests: JobOptionRequest[];
      resolve: (
        index: number,
        options: JobEntityOption[],
        selected?: JobEntityOption[],
        hasMore?: boolean,
      ) => void;
      fail: (index: number) => void;
    };
  }
}
window.optionContract = {
  requests: [],
  resolve(index, options, selected = [], hasMore = false) {
    const settle = pending[index];
    if (!settle) throw new Error(`no pending option request ${index}`);
    settle({ success: true, options, selected, hasMore });
  },
  fail(index) {
    const settle = pending[index];
    if (!settle) throw new Error(`no pending option request ${index}`);
    settle({ success: false, error: 'held_failure' });
  },
};
/** The `entity-options` background read: held until the spec resolves or fails it. */
export function readEntityOptionContract(input: unknown): Promise<JobOptionResult> {
  // The raw request is kept: a parsed one would show the schema's defaults, not what the picker sent.
  if (!isContractRequest(input)) throw new Error(`Malformed option request: ${JSON.stringify(input)}`);
  window.optionContract.requests.push(input);
  return new Promise((resolve) => pending.push(resolve));
}
