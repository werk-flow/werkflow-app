'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
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
  const [detail, setDetail] = useState<JobQualificationDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState('');
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const loadRequestRef = useRef(0);
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    try {
      const result = await getJobQualificationDetail(jobId);
      if (requestId !== loadRequestRef.current) return;
      if (!result.success) {
        setLoadFailed(true);
        return;
      }
      setDetail(result.data);
      setLoadFailed(false);
    } catch {
      if (requestId !== loadRequestRef.current) return;
      setLoadFailed(true);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestRef.current += 1;
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    };
  }, [load]);
  const scheduleLoad = useCallback(() => {
    if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    realtimeTimerRef.current = setTimeout(() => {
      realtimeTimerRef.current = null;
      void load();
    }, 250);
  }, [load]);
  useRealtimeEvent('job_capability_requirements', scheduleLoad);
  useRealtimeEvent('job_assignments', scheduleLoad);
  useRealtimeEvent('employee_capabilities', scheduleLoad);
  useRealtimeEvent('organization_capabilities', scheduleLoad);

  if (loadFailed) {
    return (
      <Card className="p-4">
        <p role="alert" className="text-sm text-destructive">
          Qualifikationsabdeckung konnte nicht geladen werden.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void load()}
        >
          Erneut versuchen
        </Button>
      </Card>
    );
  }
  if (!detail) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Qualifikationsabdeckung wird geladen…
      </Card>
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
        toast.error('Die Anforderungen konnten nicht gespeichert werden.');
        return false;
      }
      await load();
      return true;
    } catch {
      toast.error('Die Anforderungen konnten nicht gespeichert werden.');
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
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label>Anforderung hinzufügen</Label>
            <Select
              value={selectedCapabilityId}
              onValueChange={(value) => {
                setSelectedCapabilityId(value);
                const definition = detail.capabilities.find(
                  (capability) => capability.id === value
                );
                if (definition?.kind !== 'certification') {
                  setRequireConfirmation(false);
                }
              }}
            >
              <SelectTrigger aria-label="Qualifikationsanforderung auswählen">
                <SelectValue placeholder="Begriff auswählen" />
              </SelectTrigger>
              <SelectContent>
                {detail.capabilities
                  .filter(
                    (capability) =>
                      !detail.requirements.some(
                        (requirement) =>
                          requirement.capabilityId === capability.id
                      )
                  )
                  .map((capability) => (
                    <SelectItem key={capability.id} value={capability.id}>
                      {capability.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
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
