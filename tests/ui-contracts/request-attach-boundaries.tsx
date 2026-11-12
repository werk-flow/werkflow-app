import { useState } from 'react';

import { AttachRequestDialog } from '@/components/anfragen/attach-request-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { AttachRequestResult, RequestWorkTarget, WorkTargetKind } from '@/lib/requests/types';
import { holdWrite } from './held-write-boundary';

// The customer's open work the attach dialog offers; the search narrows it
// by number or title as list_request_work_targets does.
const targets: RequestWorkTarget[] = [
  {
    kind: 'job',
    id: 'contract-job-heizung',
    number: 'A-51',
    title: 'Heizungswartung Lindenhof 1',
    siteLabel: 'Lindenhof 1 · Lindenstraße 1, 10115 Berlin',
    atRequestSite: true,
  },
  {
    kind: 'project',
    id: 'contract-project-bad',
    number: 'P-12',
    title: 'Badsanierung Lindenhof 7',
    siteLabel: 'Lindenhof 7 · Lindenstraße 7, 10115 Berlin',
    atRequestSite: false,
  },
];

/** The search „Störung“ fails, as a lost connection does. */
export function readRequestWorkTargetsContract(
  input: unknown,
): { success: true; targets: RequestWorkTarget[]; hasMore: boolean } | { success: false; error: string } {
  const query =
    input && typeof input === 'object' && 'query' in input && typeof input.query === 'string'
      ? input.query.toLowerCase()
      : '';
  if (query === 'störung') return { success: false, error: 'load_failed' };
  return {
    success: true,
    targets: targets.filter((target) =>
      [target.number ?? '', target.title].some((text) => text.toLowerCase().includes(query)),
    ),
    hasMore: false,
  };
}

/** The attach waits at the write gate with the work it names. */
export async function attachRequestToWork(
  requestId: string,
  work: { kind: WorkTargetKind; id: string },
  attemptKey: string,
): Promise<AttachRequestResult> {
  const refusal = await holdWrite('attachRequestToWork', { requestId, work, attemptKey });
  if (refusal !== null) return { success: false, error: refusal };
  return { success: true, entryId: 'contract-entry' };
}

/** A saved attach offers its work; the contract stays on the fixture page. */
export function useRouter(): { push: (path: string) => void; refresh: () => void } {
  return { push: () => undefined, refresh: () => undefined };
}

export function RequestAttachContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button onClick={() => setOpen(true)}>Zu Arbeit hinzufügen</Button>
        <AttachRequestDialog
          requestId="contract-request"
          open={open}
          onOpenChange={setOpen}
          onSaved={() => undefined}
        />
      </main>
    </BannerProvider>
  );
}
