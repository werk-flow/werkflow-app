'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { buildOrganizationExportPart, startOrganizationExport } from '@/lib/org-export/actions';
import { isRetryablePartFailure, ORGANIZATION_EXPORT_MESSAGES } from '@/lib/org-export/messages';

const START_FAILED = 'Der Export konnte nicht gestartet werden. Versuche es in einem Moment erneut.';

function withRefusal(
  current: ReadonlyMap<string, string>,
  partId: string,
  code: string | null,
): ReadonlyMap<string, string> {
  const next = new Map(current);
  if (code === null) next.delete(partId);
  else next.set(partId, code);
  return next;
}

/** The banner after a run: a retry is advised only when every failure can be retried. */
function completionBanner(failures: readonly string[]) {
  if (failures.length === 0)
    return { variant: 'success', message: 'Der Export ist fertig. Lade jetzt jeden Teil herunter.' } as const;
  const advice = failures.every(isRetryablePartFailure)
    ? failures.length === 1
      ? 'Versuche ihn erneut.'
      : 'Versuche sie erneut.'
    : failures.length === 1
      ? 'Der Grund steht am Teil.'
      : 'Die Gründe stehen an den Teilen.';
  const failed =
    failures.length === 1
      ? 'Ein Teil konnte nicht erstellt werden.'
      : `${failures.length} Teile konnten nicht erstellt werden.`;
  return { variant: 'error', message: `${failed} ${advice}` } as const;
}

/**
 * Starts an export and builds its parts one request each, in order. A part
 * that fails keeps its refusal code and builds again alone; the others go on.
 * The route reads again after each part, so the page shows its state.
 */
export function useExportBuilder() {
  const router = useRouter();
  const { showBanner } = useBanner();
  const flow = usePendingTask();
  const building = useBusyIds();
  const [startRefusal, setStartRefusal] = useState<string | null>(null);
  const [partRefusals, setPartRefusals] = useState<ReadonlyMap<string, string>>(new Map());

  const buildParts = async (partIds: readonly string[]): Promise<void> => {
    const failures: string[] = [];
    for (const partId of partIds) {
      setPartRefusals((current) => withRefusal(current, partId, null));
      const result = await building
        .run(partId, () => buildOrganizationExportPart(partId))
        .catch(() => ({ success: false, error: 'export_part_failed' }) as const);
      if (!result.success) {
        failures.push(result.error);
        setPartRefusals((current) => withRefusal(current, partId, result.error));
      }
      router.refresh();
    }
    showBanner(completionBanner(failures));
  };

  const start = () => {
    setStartRefusal(null);
    void flow.run(async () => {
      const started = await startOrganizationExport().catch(
        () => ({ success: false, error: 'export_start_failed' }) as const,
      );
      if (!started.success) {
        setStartRefusal(describeFailure(started.error, ORGANIZATION_EXPORT_MESSAGES, START_FAILED));
        return;
      }
      router.refresh();
      await buildParts(started.partIds);
    });
  };

  const build = (partIds: readonly string[]) => {
    void flow.run(() => buildParts(partIds));
  };

  return { start, build, isRunning: flow.isPending, isBuilding: building.isBusy, startRefusal, partRefusals };
}
