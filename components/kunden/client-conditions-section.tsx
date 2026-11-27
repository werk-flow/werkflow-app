'use client';

import { Percent } from 'lucide-react';
import { useRef, useState } from 'react';

import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';
import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlinePending } from '@/components/ui/inline-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type { ActionResult } from '@/lib/action-result';
import { berlinToday } from '@/lib/clients/site-roles';
import { formatEuroCents } from '@/lib/document-rendering/format';
import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { recordCustomerCondition } from '@/lib/price-catalog/actions';
import type { ConditionInput } from '@/lib/price-catalog/customer-condition-form';
import {
  CONDITION_LINE_KINDS,
  CONDITION_LINE_KIND_LABELS,
  discountText,
  type CustomerCondition,
  type CustomerConditions,
} from '@/lib/price-catalog/customer-conditions';
import { formatGermanDate } from '@/lib/utils';
import { ClientConditionDialog } from './client-condition-dialog';

type VersionState = 'aktuell' | 'kommend' | 'ersetzt' | 'frueher';

const VERSION_BADGES: Record<VersionState, { label: string; variant: 'success' | 'secondary' | 'outline' }> =
  {
    aktuell: { label: 'Gilt heute', variant: 'success' },
    kommend: { label: 'Kommt', variant: 'secondary' },
    ersetzt: { label: 'Ersetzt', variant: 'outline' },
    frueher: { label: 'Früher', variant: 'outline' },
  };

function conditionVersionState(
  condition: CustomerCondition,
  conditions: CustomerConditions,
  today: string,
): VersionState {
  if (condition.id === conditions.applyingId) return 'aktuell';
  const replaced = conditions.versions.some(
    (other) => other.validFrom === condition.validFrom && other.version > condition.version,
  );
  if (replaced) return 'ersetzt';
  return condition.validFrom > today ? 'kommend' : 'frueher';
}

/** One version: its number, first day, state, the discount per kind of line and its own prices. */
function ConditionVersion({ condition, state }: { condition: CustomerCondition; state: VersionState }) {
  const badge = VERSION_BADGES[state];
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span>
          Stand {condition.version} · ab {formatGermanDate(condition.validFrom)}
        </span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </p>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        {CONDITION_LINE_KINDS.map((kind) => (
          <div key={kind} className="min-w-0">
            <dt className="text-muted-foreground">{CONDITION_LINE_KIND_LABELS[kind]}</dt>
            <dd className="tabular-nums">
              {condition.discountTenths[kind] === 0
                ? 'kein Rabatt'
                : `− ${discountText(condition.discountTenths[kind])} %`}
            </dd>
          </div>
        ))}
      </dl>
      {condition.leistungPrices.length > 0 && (
        <ul className="space-y-1 text-sm">
          {condition.leistungPrices.map((price) => {
            const unit = INVENTORY_UNITS.find((entry) => entry.code === price.unit)?.shortLabel;
            return (
              <li key={price.leistungId} className="flex flex-wrap justify-between gap-x-3">
                <span className="min-w-0 break-words">
                  {price.number} · {price.name}
                  {price.archived && (
                    <Badge variant="outline" className="ml-2">
                      Archiviert
                    </Badge>
                  )}
                </span>
                <span className="tabular-nums">
                  {formatEuroCents(price.salePriceCents)}
                  {unit ? ` je ${unit}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** The newest versions, and how many older ones the list leaves out. */
function ConditionVersions({ conditions, today }: { conditions: CustomerConditions; today: string }) {
  const left = conditions.total - conditions.versions.length;
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border p-3 sm:p-4">
        {conditions.versions.map((condition) => (
          <ConditionVersion
            key={condition.id}
            condition={condition}
            state={conditionVersionState(condition, conditions, today)}
          />
        ))}
      </ul>
      {left > 0 && (
        <p className="text-sm text-muted-foreground">
          Dazu {left === 1 ? 'kommt ein älterer Stand' : `kommen ${String(left)} ältere Stände`}, die hier
          nicht stehen.
        </p>
      )}
    </div>
  );
}

/**
 * The customer's Kundenkonditionen: the newest versions, the one that applies
 * today marked, and „Konditionen ändern“, which records a new version from
 * its first day on. A new offer Position takes its price from the version of
 * its day; a recorded version never changes. Admin and Büro only, like the page.
 */
export function ClientConditionsSection({
  clientId,
  archived,
  conditions,
}: {
  clientId: string;
  /** An archived customer takes no new version. */
  archived: boolean;
  /** The newest versions first; null for a failed read. */
  conditions: CustomerConditions | null;
}) {
  const [open, setOpen] = useState(false);
  const { showBanner } = useBanner();
  const settle = useSettleOnChange(conditions);
  // The render the save carries in its answer can land before the wait starts: wait from before the call.
  const since = useRef(0);
  const save = useServerAction(recordCustomerCondition, { settle: () => settle(since.current) });
  const today = berlinToday();

  const record = async (
    input: ConditionInput,
    expectedVersion: number,
    attemptKey: string,
  ): Promise<ActionResult> => {
    since.current = settle.markChange();
    const result = await save.run({ clientId, expectedVersion, attemptKey, ...input });
    if (!result.success && result.error === 'condition_changed') {
      // The dialog closes: the page shows the other session's version, which a new dialog starts from.
      showBanner({
        variant: 'error',
        message:
          'Jemand hat die Konditionen gerade geändert. Prüfe den neuen Stand und öffne „Konditionen ändern“ erneut.',
      });
    }
    if (result.success) {
      showBanner({
        variant: 'success',
        message: `Konditionen gespeichert. Sie gelten ab ${formatGermanDate(input.validFrom)} für neue Positionen.`,
      });
    }
    return result;
  };

  const newest = conditions?.versions[0] ?? null;
  const change = !archived && conditions && (
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
      {newest ? 'Konditionen ändern' : 'Konditionen festlegen'}
    </Button>
  );
  return (
    <section aria-labelledby="konditionen-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id="konditionen-title" icon={<Percent className="size-4" />}>
          Konditionen
        </SectionTitle>
        <div className="flex items-center gap-2">
          <InlinePending active={save.isSettling} label="Konditionen werden aktualisiert" />
          {newest && change}
        </div>
      </div>
      {!conditions ? (
        <RegionLoadError>Die Konditionen dieses Kunden konnten nicht geladen werden.</RegionLoadError>
      ) : !newest ? (
        <EmptyState
          icon={Percent}
          title="Noch keine Kundenkonditionen"
          description="Neue Positionen in Angeboten bekommen den Listenpreis. Lege Rabatte oder eigene Preise fest, die für diesen Kunden gelten."
          action={change}
        />
      ) : (
        <ConditionVersions conditions={conditions} today={today} />
      )}
      {open && (
        <ClientConditionDialog
          newest={newest}
          today={today}
          onRecord={record}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
