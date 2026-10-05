'use client';

import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { getCoverageStatusLabel, type JobQualificationDetail } from '@/lib/qualifications/types';

export type SaveJobQualificationRequirements = (
  busyId: string,
  requirements: Array<{
    capabilityId: string;
    requireConfirmation: boolean;
  }>,
) => Promise<boolean>;

type JobQualificationCoverageListProps = {
  detail: JobQualificationDetail;
  canEdit: boolean;
  isBusy: (id: string) => boolean;
  anyBusy: boolean;
  saveRequirements: SaveJobQualificationRequirements;
};

export function JobQualificationCoverageList({
  detail,
  canEdit,
  isBusy,
  anyBusy,
  saveRequirements,
}: JobQualificationCoverageListProps) {
  if (detail.evaluation.requirementCoverage.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Für diesen Auftrag sind keine Qualifikationsanforderungen hinterlegt.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {detail.evaluation.requirementCoverage.map((coverage) => (
        <div
          key={coverage.requirement.id}
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          data-testid="qualification-coverage-row"
          data-capability-name={coverage.requirement.capabilityName}
        >
          <div>
            <p className="text-sm font-medium">{coverage.requirement.capabilityName}</p>
            <p className="text-xs text-muted-foreground">
              {coverage.contributor
                ? `Abgedeckt durch ${coverage.contributor.displayName}`
                : 'Keine passende Person zugewiesen'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <InlinePending active={isBusy(coverage.requirement.id)} label="Anforderung wird entfernt" />
            <Badge variant={coverage.status === 'covered' ? 'secondary' : 'outline'}>
              {getCoverageStatusLabel(coverage.status)}
            </Badge>
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={anyBusy}
                aria-label={coverage.requirement.capabilityName + ' als Anforderung entfernen'}
                onClick={() =>
                  void saveRequirements(
                    coverage.requirement.id,
                    detail.requirements
                      .filter((requirement) => requirement.id !== coverage.requirement.id)
                      .map((requirement) => ({
                        capabilityId: requirement.capabilityId,
                        requireConfirmation: requirement.requireConfirmation,
                      })),
                  )
                }
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
