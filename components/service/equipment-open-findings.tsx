'use client';

import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { useOrganization } from '@/components/organization/organization-context';
import { StaleRegion } from '@/components/shared/stale-region';
import { Badge } from '@/components/ui/badge';
import { SectionError } from '@/components/ui/section-error';
import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import type { EquipmentOpenFinding } from '@/lib/installed-equipment/open-findings-reads';
import { MAINTENANCE_NEXT_ACTION_LABELS, MAINTENANCE_SCOPE_OUTCOME_LABELS } from '@/lib/maintenance/types';
import { formatBerlin } from '@/lib/utils';

/**
 * „Offene Mängel“ of the Anlage and its Vorgänger: what an unfinished visit
 * left, with its next step and owner, until a later completed visit closes it.
 * Hidden while nothing is open. A completion elsewhere refreshes it.
 */
export function EquipmentOpenFindingsSection({
  equipmentId,
  initial,
}: {
  equipmentId: string;
  /** The server render's findings; null when that read failed. */
  initial: EquipmentOpenFinding[] | null;
}): ReactElement | null {
  const { activeOrgId } = useOrganization();
  const live = useLiveView({
    tables: ['maintenance_due_work'],
    ...(initial ? { initialData: initial } : {}),
    resetKey: equipmentId,
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: false as const };
      const result = await readInBackground(
        'equipment-open-findings',
        { organizationId: activeOrgId, equipmentId },
        signal,
      );
      return result.success
        ? { ok: true as const, data: result.findings }
        : { ok: false as const, error: result.error };
    },
  });
  const findings = live.data;
  if (!findings && live.isLoading) return null;
  // A failed first read, or a failed refresh of an empty list, has nothing to keep on screen.
  if (!findings || (findings.length === 0 && live.isStale)) {
    return (
      <SectionError
        title="Offene Mängel konnten nicht geladen werden"
        onRetry={() => void live.refresh()}
        retryPending={live.isRefreshing}
      >
        Versuche es in einem Moment erneut.
      </SectionError>
    );
  }
  if (findings.length === 0) return null;
  return (
    <StaleRegion stale={live.isStale} onRetry={live.refresh}>
      <section className="rounded-lg border p-4 shadow-xs" aria-labelledby="equipment-open-findings">
        <div className="flex items-center gap-2">
          <AlertTriangle aria-hidden="true" className="size-4 text-warning-text" />
          <h2 id="equipment-open-findings" className="text-base font-semibold">
            Offene Mängel
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Bleiben offen, bis ein späterer Wartungsbesuch an der Anlage abgeschlossen ist.
        </p>
        <ul className="mt-3 space-y-3">
          {findings.map((finding) => (
            <li key={finding.id} className="space-y-2 rounded-md border p-3 text-sm">
              <OpenFindingEntry finding={finding} />
            </li>
          ))}
        </ul>
      </section>
    </StaleRegion>
  );
}

function OpenFindingEntry({ finding }: { finding: EquipmentOpenFinding }): ReactElement {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Wartungsbesuch am {formatBerlin(finding.visitDate, 'numericDate')}</p>
        <Badge variant="warning">{MAINTENANCE_SCOPE_OUTCOME_LABELS[finding.outcome]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Wartungsplan {finding.planNumber}
        {finding.job && (
          <>
            {' · '}
            <Link href={finding.job.href} className="font-medium text-primary-text hover:underline">
              {finding.job.label}
            </Link>
          </>
        )}
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {finding.defects.map((defect, index) => (
          <li key={index}>{defect}</li>
        ))}
      </ul>
      <p>
        <span className="font-medium">Nächster Schritt:</span>{' '}
        {MAINTENANCE_NEXT_ACTION_LABELS[finding.nextAction]}
        {finding.targetDate && ` bis ${formatBerlin(finding.targetDate, 'numericDate')}`}
        {finding.ownerName && ` · verantwortlich: ${finding.ownerName}`}
      </p>
      {finding.note && <p className="text-muted-foreground">Begründung: {finding.note}</p>}
    </>
  );
}
