'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { buildOrganizationExportPart, startOrganizationExport } from '@/lib/org-export/actions';
import { ORGANIZATION_EXPORT_MESSAGES } from '@/lib/org-export/messages';

const START_FAILED = 'Der Export konnte nicht gestartet werden. Versuche es in einem Moment erneut.';
const PART_FAILED = 'Der Teil konnte nicht erstellt werden. Versuche es erneut.';

function withMessage(
  current: ReadonlyMap<string, string>,
  partId: string,
  message: string | null,
): ReadonlyMap<string, string> {
  const next = new Map(current);
  if (message === null) next.delete(partId);
  else next.set(partId, message);
  return next;
}

function completionBanner(failures: number) {
  if (failures === 0)
    return { variant: 'success', message: 'Der Export ist fertig. Lade jetzt jeden Teil herunter.' } as const;
  return {
    variant: 'error',
    message:
      failures === 1
        ? 'Ein Teil konnte nicht erstellt werden. Versuche ihn erneut.'
        : `${failures} Teile konnten nicht erstellt werden. Versuche sie erneut.`,
  } as const;
}

/**
 * Starts an export and builds its parts one request each, in order. A part
 * that fails keeps its message and builds again alone; the others go on.
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
    let failures = 0;
    for (const partId of partIds) {
      setPartRefusals((current) => withMessage(current, partId, null));
      const result = await building
        .run(partId, () => buildOrganizationExportPart(partId))
        .catch(() => ({ success: false, error: 'export_part_failed' }) as const);
      if (!result.success) {
        failures += 1;
        const message = describeFailure(result.error, ORGANIZATION_EXPORT_MESSAGES, PART_FAILED);
        setPartRefusals((current) => withMessage(current, partId, message));
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
