'use client';

import { useState } from 'react';
import { Award, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import {
  getJobQualificationDetail,
  setJobCapabilityRequirements,
} from '@/lib/qualifications/actions';
import {
  getCoverageStatusLabel,
  type JobQualificationDetail,
} from '@/lib/qualifications/types';

export function JobQualificationSection({
  jobId,
  canEdit,
}: {
  jobId: string;
  canEdit: boolean;
}) {
  const { showBanner } = useBanner();
  const [selectedCapabilityId, setSelectedCapabilityId] = useState('');
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const view = useLiveView<JobQualificationDetail>({
    tables: [
      'job_capability_requirements',
      'job_assignments',
      'employee_capabilities',
      'organization_capabilities',
    ],
    read: async (): Promise<LiveViewResult<JobQualificationDetail>> => {
      const result = await getJobQualificationDetail(jobId);
      return result.success ? { ok: true, data: result.data } : { ok: false };
    },
    resetKey: jobId,
  });
  const { refresh } = view;
  const detail = view.data;

  if (detail === undefined) {
    if (view.isLoading) {
      return (
        <Card className="gap-4 p-4" role="status" aria-busy="true">
          <span className="sr-only">Qualifikationsabdeckung wird geladen.</span>
          <div className="flex items-center gap-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </Card>
      );
    }
    return (
      <SectionError onRetry={() => void refresh()} retryLabel="Erneut versuchen">
        Qualifikationsabdeckung konnte nicht geladen werden.
      </SectionError>
    );
  }

  const selectedDefinition = detail.capabilities.find(
    (capability) => capability.id === selectedCapabilityId
  );

  const saveRequirements = async (
    requirements: Array<{
      capabilityId: string;
      requireConfirmation: boolean;
    }>
  ) => {
    setIsSaving(true);
    try {
      const result = await setJobCapabilityRequirements({
        jobId,
        requirements,
      });
      if (!result.success) {
        showBanner({ variant: 'error', message: 'Die Anforderungen konnten nicht gespeichert werden.' });
        return false;
      }
      await refresh();
      return true;
    } catch {
      showBanner({ variant: 'error', message: 'Die Anforderungen konnten nicht gespeichert werden.' });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="gap-4 p-4">
      <div>
        <div className="flex items-center gap-2">
          <Award className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Qualifikationsabdeckung</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Zeigt die von der Organisation hinterlegten Planungshinweise. Keine
          rechtliche Einsatzbewertung.
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Anforderung hinzufügen" htmlFor="job-qualification-capability" className="min-w-56 flex-1">
            <SearchableSelect
              options={detail.capabilities
                .filter(
                  (capability) =>
                    !detail.requirements.some(
                      (requirement) =>
                        requirement.capabilityId === capability.id
                    )
                )
                .map((capability) => ({
                  value: capability.id,
                  label: capability.name,
                }))}
              value={selectedCapabilityId}
              onChange={(value) => {
                setSelectedCapabilityId(value);
                const definition = detail.capabilities.find(
                  (capability) => capability.id === value
                );
                if (definition?.kind !== 'certification') {
                  setRequireConfirmation(false);
                }
              }}
              placeholder="Begriff auswählen"
              searchPlaceholder="Begriff suchen..."
              emptyMessage="Kein Begriff gefunden"
            />
          </Field>
          {selectedDefinition?.kind === 'certification' && (
            <div className="flex h-9 items-center gap-2">
              <Checkbox
                id="job-require-confirmation"
                checked={requireConfirmation}
                onCheckedChange={(value) =>
                  setRequireConfirmation(value === true)
                }
              />
              <Label htmlFor="job-require-confirmation">
                Bestätigung erforderlich
              </Label>
            </div>
          )}
          <Button
            variant="outline"
            disabled={!selectedCapabilityId || isSaving}
            onClick={async () => {
              const saved = await saveRequirements([
                ...detail.requirements.map((requirement) => ({
                  capabilityId: requirement.capabilityId,
                  requireConfirmation: requirement.requireConfirmation,
                })),
                {
                  capabilityId: selectedCapabilityId,
                  requireConfirmation,
                },
              ]);
              if (saved) {
                setSelectedCapabilityId('');
                setRequireConfirmation(false);
              }
            }}
          >
            Hinzufügen
          </Button>
        </div>
      )}

      {detail.evaluation.requirementCoverage.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Für diesen Auftrag sind keine Qualifikationsanforderungen hinterlegt.
        </p>
      ) : (
        <div className="space-y-2">
          {detail.evaluation.requirementCoverage.map((coverage) => (
            <div
              key={coverage.requirement.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              data-testid="qualification-coverage-row"
              data-capability-name={coverage.requirement.capabilityName}
            >
              <div>
                <p className="text-sm font-medium">
                  {coverage.requirement.capabilityName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {coverage.contributor
                    ? `Abgedeckt durch ${coverage.contributor.displayName}`
                    : 'Keine passende Person zugewiesen'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Badge
                  variant={
                    coverage.status === 'covered' ? 'secondary' : 'outline'
                  }
                >
                  {getCoverageStatusLabel(coverage.status)}
                </Badge>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isSaving}
                    aria-label={
                      coverage.requirement.capabilityName +
                      ' als Anforderung entfernen'
                    }
                    onClick={() =>
                      void saveRequirements(
                        detail.requirements
                          .filter(
                            (requirement) =>
                              requirement.id !== coverage.requirement.id
                          )
                          .map((requirement) => ({
                            capabilityId: requirement.capabilityId,
                            requireConfirmation:
                              requirement.requireConfirmation,
                          }))
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
      )}

      {detail.latestAssessment?.overrideReason && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
          <span className="font-medium">Letzte begründete Ausnahme:</span>{' '}
          {detail.latestAssessment.overrideReason}
        </div>
      )}
    </Card>
  );
}
