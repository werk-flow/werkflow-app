'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { promoteCallerToClient, reopenClientRequest, updateClientRequest } from '@/lib/requests/actions';
import type { ClientRequest } from '@/lib/requests/types';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const PROMOTE_ERROR_MESSAGES = {
  caller_name_required: 'Zum Anlegen wird mindestens der Name der Anruferin / des Anrufers benötigt.',
} satisfies Record<string, string>;

interface RequestDetailActions {
  isPending: boolean;
  isSettling: boolean;
  /** The status the header shows: the optimistic echo, else the stored one. */
  shownStatus: ClientRequest['status'];
  headerError: string | null;
  promoteError: string | null;
  markSettling: () => void;
  handleStatusToggle: () => void;
  handleReopen: () => void;
  handlePromote: () => void;
  matchOpen: boolean;
  matchClientId: string;
  matchSiteId: string;
  matchContactId: string;
  matchError: string | null;
  matchClientError: string | null;
  setMatchOpen: (open: boolean) => void;
  handleMatchOpenChange: (open: boolean) => void;
  selectMatchClient: (clientId: string) => void;
  setMatchSiteId: (siteId: string) => void;
  setMatchContactId: (contactId: string) => void;
  handleMatchConfirm: () => void;
}

/** Header, customer-card and match-dialog actions of one request with their pending and error state. */
export function useRequestDetailActions(request: ClientRequest): RequestDetailActions {
  const router = useRouter();
  const { run: runPendingTask, isPending } = usePendingTask();
  // After a confirmed change the header keeps its indicator until the
  // refreshed request lands (settling), without disabling the actions.
  const { run: runSettle, isPending: isSettling } = usePendingTask();
  const waitForChange = useSettleOnChange(request);
  const { showBanner } = useBanner();
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchClientId, setMatchClientId] = useState('');
  const [matchSiteId, setMatchSiteId] = useState('');
  const [matchContactId, setMatchContactId] = useState('');
  // Failures render where the action was taken: header, customer card, dialog.
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchClientError, setMatchClientError] = useState<string | null>(null);
  // The status toggle shows its target at once. The echo ends when the
  // refreshed request arrives, or with the error when the server refuses.
  const [statusEcho, setStatusEcho] = useState<'offen' | 'in_klaerung' | null>(null);
  const shownStatus = statusEcho ?? request.status;

  function markSettling(): void {
    void runSettle(waitForChange);
  }

  function changeStatus(nextStatus: 'offen' | 'in_klaerung', previousStatus: 'offen' | 'in_klaerung'): void {
    setHeaderError(null);
    setStatusEcho(nextStatus);
    void runPendingTask(async () => {
      const result = await updateClientRequest(request.id, { status: nextStatus }).catch(() => null);
      if (!result?.success) {
        setStatusEcho(null);
        setHeaderError('Der Status konnte nicht geändert werden. Bitte versuche es erneut.');
        return;
      }
      showBanner({
        variant: 'success',
        message: nextStatus === 'in_klaerung' ? 'Anfrage ist jetzt in Klärung.' : 'Anfrage ist wieder offen.',
        actionLabel: 'Rückgängig',
        onAction: () => changeStatus(previousStatus, nextStatus),
      });
      router.refresh();
      void runSettle(async () => {
        await waitForChange();
        setStatusEcho(null);
      });
    });
  }

  function handleStatusToggle(): void {
    if (shownStatus !== 'offen' && shownStatus !== 'in_klaerung') return;
    changeStatus(shownStatus === 'offen' ? 'in_klaerung' : 'offen', shownStatus);
  }

  function handleReopen(): void {
    setHeaderError(null);
    void runPendingTask(async () => {
      const result = await reopenClientRequest(request.id);
      if (!result.success) {
        setHeaderError('Die Anfrage konnte nicht wieder geöffnet werden.');
        return;
      }
      showBanner({ variant: 'success', message: 'Anfrage wurde wieder geöffnet.' });
      router.refresh();
      markSettling();
    });
  }

  function handlePromote(): void {
    setPromoteError(null);
    if (!request.callerName?.trim()) {
      setPromoteError(PROMOTE_ERROR_MESSAGES.caller_name_required);
      return;
    }
    void runPendingTask(async () => {
      const result = await promoteCallerToClient(request.id);
      if (!result.success) {
        setPromoteError(
          describeFailure(result.error, PROMOTE_ERROR_MESSAGES, 'Der Kunde konnte nicht angelegt werden.'),
        );
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Kunde wurde angelegt und der Anfrage zugeordnet.',
      });
      router.refresh();
      markSettling();
    });
  }

  function handleMatchOpenChange(open: boolean): void {
    setMatchOpen(open);
    if (!open) {
      setMatchClientId('');
      setMatchSiteId('');
      setMatchContactId('');
      setMatchError(null);
      setMatchClientError(null);
    }
  }

  function selectMatchClient(clientId: string): void {
    setMatchClientId(clientId);
    setMatchClientError(null);
    setMatchSiteId('');
    setMatchContactId('');
  }

  function handleMatchConfirm(): void {
    if (!matchClientId) {
      const message = 'Bitte wähle einen Kunden aus.';
      setMatchClientError(message);
      focusFirstInvalidField({ 'match-client': message });
      return;
    }
    setMatchError(null);
    void runPendingTask(async () => {
      const result = await updateClientRequest(request.id, {
        clientId: matchClientId,
        siteId: matchSiteId || null,
        contactId: matchContactId || null,
      });
      if (!result.success) {
        setMatchError('Der Kunde konnte nicht zugeordnet werden.');
        return;
      }
      setMatchOpen(false);
      setMatchClientId('');
      setMatchSiteId('');
      setMatchContactId('');
      showBanner({ variant: 'success', message: 'Kunde wurde zugeordnet.' });
      router.refresh();
      markSettling();
    });
  }

  return {
    isPending,
    isSettling,
    shownStatus,
    headerError,
    promoteError,
    markSettling,
    handleStatusToggle,
    handleReopen,
    handlePromote,
    matchOpen,
    matchClientId,
    matchSiteId,
    matchContactId,
    matchError,
    matchClientError,
    setMatchOpen,
    handleMatchOpenChange,
    selectMatchClient,
    setMatchSiteId,
    setMatchContactId,
    handleMatchConfirm,
  };
}
