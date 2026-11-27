// „Versand“ of a Servicebericht: the real dialog over a report with no sends
// yet, its read answered at once, its email and manual record held until the
// spec answers (held-write-boundary.ts). The refusal `lost_answer` throws, as
// when the request reached the server but its answer did not come back.
import { useState } from 'react';

import { ServiceReportDeliveryDialog } from '@/components/service/service-report-delivery-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

const REPORT_ID = '98300000-0000-4000-8000-000000000001';

export function readServiceReportDeliveryContract(): unknown {
  return {
    success: true,
    delivery: {
      list: { total: 0, entries: [] },
      defaults: {
        recipient: 'hausmeister@lindenhof.example',
        subject: 'Servicebericht zur Wartung vom 12.11.2037 – Haustechnik Sonnenberg GmbH',
        text: 'Guten Tag,\n\nanbei der Servicebericht zur Wartung vom 12.11.2037.',
      },
    },
  };
}

async function heldAnswer<Accepted>(kind: string, input: unknown, accepted: Accepted) {
  const refusal = await holdWrite(kind, input);
  if (refusal === 'lost_answer') throw new Error('The answer was lost.');
  return refusal ? { success: false as const, error: refusal } : accepted;
}

export const sendServiceReportEmail = (input: unknown) =>
  heldAnswer('sendServiceReportEmail', input, {
    success: true as const,
    state: 'sent' as const,
    failureCode: null,
  });

export const markServiceReportSentManually = (input: unknown) =>
  heldAnswer('markServiceReportSentManually', input, { success: true as const });

export const retryServiceReportDelivery = unexpectedWrite;

/** The report list's „Versand“ button and the dialog it opens. */
export function ServiceReportDeliveryContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button type="button" onClick={() => setOpen(true)}>
          Versand
        </Button>
        {open && (
          <ServiceReportDeliveryDialog
            reportId={REPORT_ID}
            visitLabel="12.11.2037 · WP-0004"
            onClose={() => setOpen(false)}
          />
        )}
      </main>
    </BannerProvider>
  );
}
