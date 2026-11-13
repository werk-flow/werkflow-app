'use client';

import { useCallback, useRef } from 'react';

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
  // Whether the live view's latest read landed, for the reread after a refused save.
  const lastReadLanded = useRef<boolean | null>(null);
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
      lastReadLanded.current = result.success;
      return result.success
        ? { ok: true, data: result.parties }
        : { ok: false, error: describeFailure(result.error, {}, WORK_BILLING_PARTIES_LOAD_FAILED) };
    },
    enabled: Boolean(activeOrgId),
    // An organization switch is a new scope too: it never keeps the previous one's parties.
    resetKey: billingPartiesScope(activeOrgId, kind, id),
  });
  const { refresh } = view;
  // The reread after a refused save runs the live view's own guarded read, so
  // it never overwrites a fresher one and a failure marks the view stale; it
  // says whether the read landed, for the dialog's notice or its retry.
  const reread = useCallback(async (): Promise<boolean> => {
    lastReadLanded.current = null;
    await refresh();
    return lastReadLanded.current === true;
  }, [refresh]);
  return { view, reread };
}
