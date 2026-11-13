'use client';

import { useCallback } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import { isEventForRow } from '@/lib/realtime/events';
import type { RealtimeTable } from '@/lib/realtime/tables';
import type { BillingWorkKind, WorkBillingParties } from '@/lib/billing-parties/types';
import { billingPartiesScope } from '@/lib/billing-parties/resolve';

export const WORK_BILLING_PARTIES_LOAD_FAILED =
  'Auftraggeber und Rechnungsempfänger konnten nicht geladen werden.';
export const WORK_BILLING_PARTIES_STALE =
  'Auftraggeber und Rechnungsempfänger konnten nicht aktualisiert werden und sind eventuell nicht mehr aktuell.';

// A change of the parties touches the work's own row, so the work's table signals it.
const WORK_TABLE: Readonly<Record<BillingWorkKind, RealtimeTable>> = {
  request: 'client_requests',
  job: 'jobs',
  project: 'projects',
  service_case: 'service_cases',
};

/**
 * The live parties of one work. With `initialParties` from the page's server
 * read, the view opens without a read of its own; without, it reads after mount.
 */
export function useWorkBillingParties(
  kind: BillingWorkKind,
  id: string,
  initialParties: WorkBillingParties | undefined,
) {
  const { activeOrgId } = useOrganization();
  const view = useLiveView<WorkBillingParties>({
    tables: [WORK_TABLE[kind], 'clients', 'client_sites', 'client_contacts'],
    initialData: initialParties,
    // Another work's change leaves this one as it is. The read also shows the
    // Auftraggeber's current name, the site and its access contacts, so a
    // customer, site or contact edit reads again; the frozen recipient stays.
    eventFilter: (event) => event.table !== WORK_TABLE[kind] || isEventForRow(event, id),
    read: async ({ signal }): Promise<LiveViewResult<WorkBillingParties>> => {
      const result = await readInBackground(
        'work-billing-parties',
        { organizationId: activeOrgId ?? '', kind, id },
        signal,
      );
      return result.success
        ? { ok: true, data: result.parties }
        : { ok: false, error: describeFailure(result.error, {}, WORK_BILLING_PARTIES_LOAD_FAILED) };
    },
    enabled: Boolean(activeOrgId),
    // An organization switch is a new scope too: it never keeps the previous one's parties.
    resetKey: billingPartiesScope(activeOrgId, kind, id),
  });
  const { invalidate, setData } = view;
  // The reread after a refused save says whether it landed: the dialog shows
  // the newer pair only then, and a load error with a retry otherwise.
  const reread = useCallback(async (): Promise<boolean> => {
    invalidate();
    const result = await readInBackground('work-billing-parties', {
      organizationId: activeOrgId ?? '',
      kind,
      id,
    }).catch(() => null);
    if (!result?.success) return false;
    setData(() => result.parties);
    return true;
  }, [activeOrgId, kind, id, invalidate, setData]);
  return { view, reread };
}
