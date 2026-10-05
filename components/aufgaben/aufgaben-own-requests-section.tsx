import Link from 'next/link';

import { Card } from '@/components/ui/card';
import type { AttentionOverview } from '@/lib/attention/types';
import { VACATION_STATUS_LABELS } from '@/lib/vacation/types';
import { formatVacationDays } from '@/lib/vacation/balance';
import { formatRange } from './aufgaben-format';

export function AufgabenOwnRequestsSection({
  ownRequests,
}: {
  ownRequests: AttentionOverview['ownRequests'];
}) {
  return (
    <section className="space-y-4" aria-labelledby="meine-antraege-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="meine-antraege-heading" className="text-sm font-semibold">
          Meine Anträge
        </h2>
        <Link href="/zeiterfassung" className="text-sm text-primary-text hover:underline">
          Zur Zeiterfassung
        </Link>
      </div>

      {ownRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine eigenen Urlaubsanträge.</p>
      ) : (
        <Card className="gap-0 divide-y py-0" data-testid="attention-own-requests">
          {ownRequests.map((request) => (
            <div
              key={request.sourceId}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              data-own-request-source={request.sourceId}
            >
              <div className="min-w-0">
                <p className="text-sm tabular-nums">
                  {formatRange(request.startDate, request.endDate)}
                  {request.dayPortion === 'half_day' ? ' (halbtags)' : ''}
                  {` · ${formatVacationDays(request.totalDays)}`}
                </p>
                {request.decisionReason && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Grund: {request.decisionReason}</p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{VACATION_STATUS_LABELS[request.status]}</p>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
