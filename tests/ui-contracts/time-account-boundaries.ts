// Isolated stand-in for `@/lib/time-accounts/actions`: the opening date
// correction reads its accounts as route props, and a correction waits in the
// write gate until the spec answers it. An accepted correction moves the date
// and adds its history line, then re-renders the route as revalidatePath does.
import type { TimeAccountActionResult } from '@/lib/time-accounts/messages';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';
import { holdWrite } from './held-write-boundary';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

declare global {
  interface Window {
    uiContractTimeAccounts: TimeAccountSettingsData['accounts'];
  }
}

window.uiContractTimeAccounts = [
  {
    id: 'contract-account',
    employeeRecordId: 'contract-worker-record',
    employeeName: 'Kevin Kontrakt',
    currentBalanceMinutes: 0,
    version: 1,
    openedOn: '2026-10-29',
    canCorrectOpenedOn: true,
    openingCorrections: [],
  },
];

export async function correctTimeAccountOpeningDate(
  formData: FormData,
): Promise<TimeAccountActionResult<'correctOpening'>> {
  const input = Object.fromEntries(formData);
  const refusal = await holdWrite('correct-opening-date', input);
  if (refusal === 'opening_date_locked') return { success: false, error: refusal };
  if (refusal !== null) return { success: false, error: 'correction_failed' };
  window.uiContractTimeAccounts = window.uiContractTimeAccounts.map((account) =>
    account.id === input.accountId
      ? {
          ...account,
          openedOn: String(input.openedOn),
          version: account.version + 1,
          openingCorrections: [
            ...account.openingCorrections,
            {
              id: 'contract-correction',
              previousOpenedOn: account.openedOn,
              correctedOpenedOn: String(input.openedOn),
              reason: String(input.reason),
              createdAt: '2026-10-30T10:00:00.000Z',
            },
          ],
        }
      : account,
  );
  window.dispatchEvent(new Event(ROUTE_REFRESH_EVENT));
  return { success: true };
}
