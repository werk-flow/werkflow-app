'use client';

import { useState, type ReactElement } from 'react';
import { FileCheck2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { linkServiceCaseEvidence } from '@/lib/service-cases/actions';
import type { ServiceCaseDetail, ServiceCaseEvidenceOption } from '@/lib/service-cases/types';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import { EvidenceDialog } from './service-case-detail-dialogs';

const EVIDENCE_ERRORS: Record<string, string> = {
  service_case_stale_version:
    'Der Servicefall wurde inzwischen geändert. Prüfe den aktuellen Stand und versuche es erneut.',
};

type ServiceCaseEvidenceLinkProps = {
  serviceCase: Pick<ServiceCaseDetail, 'id' | 'version' | 'jobId' | 'evidence'>;
  /** Unlinked versions of the case's job. */
  options: ServiceCaseEvidenceOption[];
  isStale: boolean;
  /** Discards reads that started before the write. */
  invalidate: () => void;
  /** The authoritative read that confirms the link. */
  refresh: () => Promise<void>;
};

/**
 * Owns the evidence link of a service case. The chosen version shows in the
 * list in the first frame while the dialog stays pending; a refusal removes it
 * and shows the reason in the dialog. Success closes the dialog, confirms with
 * a banner and keeps the version listed until the live read lands.
 */
export function ServiceCaseEvidenceLink({
  serviceCase,
  options,
  isStale,
  invalidate,
  refresh,
}: ServiceCaseEvidenceLinkProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The version being linked, listed until the live read confirms or drops it.
  const [pendingOption, setPendingOption] = useState<ServiceCaseEvidenceOption | null>(null);
  const { showBanner } = useBanner();
  const link = useServerAction(
    async (option: ServiceCaseEvidenceOption): Promise<boolean> => {
      invalidate();
      setError(null);
      setPendingOption(option);
      const result = await linkServiceCaseEvidence({
        serviceCaseId: serviceCase.id,
        workArtifactRevisionId: option.revisionId,
        expectedVersion: serviceCase.version,
        idempotencyKey: crypto.randomUUID(),
      }).catch(() => null);
      if (!result?.success) {
        setPendingOption(null);
        const fallback = `Der Arbeitsnachweis „${option.title}“ konnte nicht verknüpft werden. Bitte versuche es erneut.`;
        setError(result ? describeFailure(result.error, EVIDENCE_ERRORS, fallback) : fallback);
        return false;
      }
      setOpen(false);
      showBanner({ variant: 'success', message: 'Arbeitsnachweis wurde verknüpft.' });
      return true;
    },
    {
      settle: async (linked) => {
        if (!linked) return;
        try {
          await refresh();
        } finally {
          setPendingOption(null);
        }
      },
    },
  );
  const busy = link.isPending || link.isSettling;
  const pendingShown =
    pendingOption && !serviceCase.evidence.some((item) => item.revisionId === pendingOption.revisionId)
      ? pendingOption
      : null;

  return (
    <section className="rounded-lg border p-4 shadow-xs" data-testid="service-case-evidence">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Arbeitsnachweise</h2>
          <p className="mt-1 text-sm text-muted-foreground">Exakte Versionen aus dem zugeordneten Auftrag.</p>
        </div>
        <span className="flex items-center gap-2">
          <InlinePending active={busy} label="Änderungen werden übernommen" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
            disabled={isStale || busy || !serviceCase.jobId || options.length === 0}
          >
            <FileCheck2 className="size-4" />
            Verknüpfen
          </Button>
        </span>
      </div>
      {serviceCase.evidence.length || pendingShown ? (
        <div className="mt-3 divide-y rounded-md border">
          {serviceCase.evidence.map((evidence) => (
            <EvidenceRow key={evidence.id} evidence={evidence} />
          ))}
          {pendingShown && <EvidenceRow evidence={pendingShown} pending />}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {serviceCase.jobId ? 'Noch kein Arbeitsnachweis verknüpft.' : 'Ordne zuerst einen Auftrag zu.'}
        </p>
      )}
      {(open || link.isPending) && (
        <EvidenceDialog
          open={open}
          onOpenChange={setOpen}
          options={options}
          isPending={link.isPending}
          error={error}
          onLink={(option) => void link.run(option)}
        />
      )}
    </section>
  );
}

function EvidenceRow({
  evidence,
  pending = false,
}: {
  evidence: ServiceCaseEvidenceOption;
  pending?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center gap-2 p-3 text-sm" data-testid="service-case-evidence-row">
      <InlinePending active={pending} label="Wird verknüpft" />
      <span className="font-medium">{evidence.title}</span>
      <span className="text-xs text-muted-foreground">
        {WORK_ARTIFACT_KIND_LABELS[evidence.kind]} · Version {evidence.revisionNumber}
      </span>
    </div>
  );
}
