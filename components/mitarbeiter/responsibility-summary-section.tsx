import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import {
  ORGANIZATION_RESPONSIBILITIES,
  RESPONSIBILITY_LABELS,
} from '@/lib/responsibilities/types';

export function ResponsibilitySummarySection({
  employeeRecordId,
  data,
}: {
  employeeRecordId: string;
  data: ResponsibilitySettingsData;
}) {
  const currentResponsibilities = ORGANIZATION_RESPONSIBILITIES.filter(
    (responsibility) =>
      data.effective[responsibility].holders.some(
        (holder) => holder.employeeRecordId === employeeRecordId
      )
  );
  const activeDelegations = data.delegations.filter(
    (delegation) =>
      delegation.validFrom <= data.businessDate &&
      delegation.validUntil >= data.businessDate &&
      (delegation.revokedFrom === null ||
        delegation.revokedFrom > data.businessDate) &&
      (delegation.delegatorEmployeeRecordId === employeeRecordId ||
        delegation.substituteEmployeeRecordId === employeeRecordId)
  );

  return (
    <section className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="size-4" />
            Verantwortlichkeiten & Vertretung
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Effektive Freigaben für die aktive Organisation.
          </p>
        </div>
        <Link
          href="/einstellungen/mitarbeiter"
          className="text-sm font-medium text-primary hover:underline"
        >
          Einstellungen öffnen
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {currentResponsibilities.length > 0 ? (
          currentResponsibilities.map((responsibility) => (
            <Badge key={responsibility} variant="secondary">
              {RESPONSIBILITY_LABELS[responsibility]}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">
            Aktuell keine Freigabeverantwortung.
          </span>
        )}
        {activeDelegations.length > 0 ? (
          <Badge variant="outline">
            {activeDelegations.length}{' '}
            {activeDelegations.length === 1 ? 'Vertretung' : 'Vertretungen'}
          </Badge>
        ) : null}
      </div>
    </section>
  );
}
