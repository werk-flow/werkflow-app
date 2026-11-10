import { CreateRequestDialog } from '@/components/anfragen/create-request-dialog';
import { BannerProvider } from '@/components/ui/banner';
import type { CreateClientRequestInput } from '@/lib/requests/actions';
import type { ClientRequestResult } from '@/lib/requests/types';
import { contractRequest } from './feedback-boundaries';
import { holdWrite } from './held-write-boundary';

// The capture dialog's save waits at the write gate with its summary and
// attempt key. The answer `lost` drops the response as a broken connection
// does: the save may have landed, and the dialog never hears of it.
export async function createClientRequest(
  input: CreateClientRequestInput,
  attemptKey?: string,
): Promise<ClientRequestResult> {
  const refusal = await holdWrite('createClientRequest', { summary: input.summary, attemptKey });
  if (refusal === 'lost') throw new Error('The response was lost.');
  if (refusal !== null) return { success: false, error: refusal };
  return {
    success: true,
    request: contractRequest('contract-request-captured', input.summary, 'offen').request,
  };
}

/** A saved capture opens its request; the contract stays on the fixture page. */
export function useRouter(): { push: (path: string) => void; refresh: () => void } {
  return { push: () => undefined, refresh: () => undefined };
}

export function RequestCaptureContractFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <CreateRequestDialog assignees={[]} currentUserId="contract-user" />
      </main>
    </BannerProvider>
  );
}
