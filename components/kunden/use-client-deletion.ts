'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { restoreClient } from '@/lib/clients/actions';
import { loadDocument } from '@/lib/navigation/document-load';
import { CLIENT_RESTORE_ERROR_MESSAGES, type ClientRemoval } from './client-removal-dialog';

/**
 * The customer detail page's archive, delete and restore: the dialog state,
 * the page's reaction to each outcome and the restore action.
 */
export function useClientRemoval(client: { id: string; name: string }) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [removal, setRemoval] = useState<ClientRemoval | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  /** Read by event handlers that must see the deletion before the next render. */
  const isLeavingRef = useRef(false);
  const { run: runRestore, isPending: isRestoring } = usePendingTask();

  const onRemoved = async (done: ClientRemoval): Promise<void> => {
    if (done === 'delete') {
      isLeavingRef.current = true;
      setIsLeaving(true);
      // Full document load: a soft router.push after this server action can
      // fail to commit (the deletion stall: DELETE succeeds, the URL never
      // changes), and the deleted record's page would redirect first and drop
      // the banner parameter. Leaving it loses no state worth keeping.
      loadDocument(`/kunden?deleted_client=${encodeURIComponent(client.name)}`);
      return untilPageLeaves();
    }
    setRemoval(null);
    showBanner({ variant: 'success', message: `Kunde „${client.name}“ wurde archiviert.` });
    router.refresh();
  };

  const restore = () =>
    runRestore(async () => {
      const result = await restoreClient(client.id).catch(() => null);
      if (!result?.success) {
        const reason = result
          ? describeFailure(result.error, CLIENT_RESTORE_ERROR_MESSAGES, 'Bitte versuche es erneut.')
          : 'Bitte versuche es erneut.';
        showBanner({
          variant: 'error',
          message: `Kunde „${client.name}“ konnte nicht wiederhergestellt werden: ${reason}`,
        });
        return;
      }
      showBanner({ variant: 'success', message: `Kunde „${client.name}“ wurde wiederhergestellt.` });
      router.refresh();
    });

  return {
    removal,
    openRemoval: setRemoval,
    closeRemoval: () => setRemoval(null),
    onRemoved,
    isLeaving,
    isLeavingRef,
    restore,
    isRestoring,
  };
}
