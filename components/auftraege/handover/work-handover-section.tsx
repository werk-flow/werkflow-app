'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  WORK_HANDOVER_STATE_LABELS,
  type WorkHandoverFieldStatus,
  type WorkHandoverWorkspace,
} from '@/lib/work-handover/types';
import { openDocument } from './work-handover-document';

export function WorkHandoverSummary({
  workspace,
  href,
}: {
  workspace: WorkHandoverWorkspace;
  href: string;
}): ReactElement {
  const actionLabel =
    workspace.packageState === 'released'
      ? 'Übergabe ansehen'
      : workspace.executionState === 'execution_complete'
        ? 'Übergabe prüfen'
        : 'Übergabestand ansehen';
  return (
    <Card className="gap-0 border py-0 shadow-xs" data-testid="work-handover-summary">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Übergabe an das Büro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {WORK_HANDOVER_STATE_LABELS[workspace.packageState]}
            {workspace.currentReleaseNumber ? ` · Freigabe ${workspace.currentReleaseNumber}` : ''}
          </p>
        </div>
        <Button asChild variant={workspace.executionState === 'execution_complete' ? 'default' : 'outline'}>
          <Link href={href}>{actionLabel}</Link>
        </Button>
      </div>
    </Card>
  );
}

export function FieldWorkHandoverStatus({ status }: { status: WorkHandoverFieldStatus }): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const { run: runDocumentTask, isPending: pending } = usePendingTask();
  return (
    <section
      className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
      aria-labelledby="field-handover-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="field-handover-heading" className="font-semibold">
            Übergabestand
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{WORK_HANDOVER_STATE_LABELS[status.state]}</p>
        </div>
        {status.releaseNumber && <Badge variant="secondary">Freigabe {status.releaseNumber}</Badge>}
      </div>
      {status.documentId && (
        <Button
          pending={pending}
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={pending}
          onClick={() => {
            if (!status.documentId) return;
            const openPromise = openDocument(status.documentId);
            void runDocumentTask(async () => setError(await openPromise));
          }}
        >
          <Download />
          Übergabedokument
        </Button>
      )}
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </section>
  );
}
