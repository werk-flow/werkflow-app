'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange, type SettleOnChange } from '@/hooks/use-settle-on-change';
import { promoteCallerToClient, reopenClientRequest, updateClientRequest } from '@/lib/requests/actions';
import type { CallerMatch, ClientRequest } from '@/lib/requests/types';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const PROMOTE_ERROR_MESSAGES = {
  caller_name_required: 'Zum Anlegen wird mindestens der Name der Anruferin / des Anrufers benötigt.',
  caller_matches_customer:
    'Inzwischen passt ein vorhandener Kunde zur Anruferin / zum Anrufer. Prüf die Treffer oder leg trotzdem neu an.',
} satisfies Record<string, string>;

interface RequestDetailActions {
  isPending: boolean;
  isSettling: boolean;
  /** The status the header shows: the optimistic echo, else the stored one. */
  shownStatus: ClientRequest['status'];
  headerError: string | null;
  /** A failed assignment or promotion, shown in the customer card. */
  customerError: string | null;
  /** The first press found matching customers; the next press creates one anyway. */
  promoteArmed: boolean;
  markSettling: () => void;
  handleStatusToggle: () => void;
  handleReopen: () => void;
  handleAssignMatch: (match: CallerMatch) => void;
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

type RequestMatch = Pick<
  RequestDetailActions,
  | 'matchOpen'
  | 'matchClientId'
  | 'matchSiteId'
  | 'matchContactId'
  | 'matchError'
  | 'matchClientError'
  | 'setMatchOpen'
  | 'handleMatchOpenChange'
  | 'selectMatchClient'
  | 'setMatchSiteId'
  | 'setMatchContactId'
  | 'handleMatchConfirm'
>;

/** What the detail actions share: the request, the pending task, the banner, the router and settling. */
type DetailActionContext = {
  requestId: string;
  runPendingTask: ReturnType<typeof usePendingTask>['run'];
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  router: ReturnType<typeof useRouter>;
  markSettling: () => void;
};

/** The dialog that matches an existing customer, with its site and contact, to an unknown caller. */
function useRequestMatch({
  requestId,
  runPendingTask,
  showBanner,
  router,
  markSettling,
}: DetailActionContext): RequestMatch {
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchClientId, setMatchClientId] = useState('');
  const [matchSiteId, setMatchSiteId] = useState('');
  const [matchContactId, setMatchContactId] = useState('');
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchClientError, setMatchClientError] = useState<string | null>(null);

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
      const result = await updateClientRequest(requestId, {
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

/**
 * The open / in-Klärung toggle with its undo. The toggle shows its target at
 * once; the echo ends when the refreshed request arrives, or with the error
 * when the server refuses.
 */
function useRequestStatusToggle({
  request,
  context: { runPendingTask, showBanner, router },
  runSettle,
  waitForChange,
  setHeaderError,
}: {
  request: ClientRequest;
  context: DetailActionContext;
  runSettle: ReturnType<typeof usePendingTask>['run'];
  waitForChange: SettleOnChange;
  setHeaderError: (error: string | null) => void;
}): Pick<RequestDetailActions, 'shownStatus' | 'handleStatusToggle'> {
  const [statusEcho, setStatusEcho] = useState<'offen' | 'in_klaerung' | null>(null);
  const shownStatus = statusEcho ?? request.status;

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

  return { shownStatus, handleStatusToggle };
}

/**
 * The customer card's actions: assign a matching customer in one press, or
 * create a new one. While the caller matches a customer, the first press only
 * arms the create button; the second creates the customer anyway.
 */
function useCustomerCardActions(
  request: ClientRequest,
  hasCallerMatches: boolean,
  { runPendingTask, showBanner, router, markSettling }: DetailActionContext,
): Pick<RequestDetailActions, 'customerError' | 'promoteArmed' | 'handleAssignMatch' | 'handlePromote'> {
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [promoteArmed, setPromoteArmed] = useState(false);

  function handleAssignMatch(match: CallerMatch): void {
    setCustomerError(null);
    void runPendingTask(async () => {
      const result = await updateClientRequest(request.id, { clientId: match.clientId });
      if (!result.success) {
        setCustomerError(`${match.clientName} konnte nicht zugeordnet werden. Bitte versuche es erneut.`);
        return;
      }
      showBanner({ variant: 'success', message: `${match.clientName} wurde zugeordnet.` });
      router.refresh();
      markSettling();
    });
  }

  function handlePromote(): void {
    setCustomerError(null);
    if (!request.callerName?.trim()) {
      setCustomerError(PROMOTE_ERROR_MESSAGES.caller_name_required);
      return;
    }
    if (hasCallerMatches && !promoteArmed) {
      setPromoteArmed(true);
      return;
    }
    void runPendingTask(async () => {
      const result = await promoteCallerToClient(request.id, { createDespiteMatches: promoteArmed });
      if (!result.success) {
        if (result.error === 'caller_matches_customer') {
          setPromoteArmed(true);
          router.refresh();
        }
        setCustomerError(
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

  return { customerError, promoteArmed, handleAssignMatch, handlePromote };
}

/**
 * Header, customer-card and match-dialog actions of one request with their
 * pending and error state. `hasCallerMatches` is whether the page shows
 * customers the caller may already be.
 */
export function useRequestDetailActions(
  request: ClientRequest,
  hasCallerMatches: boolean,
): RequestDetailActions {
  const router = useRouter();
  const { run: runPendingTask, isPending } = usePendingTask();
  // After a confirmed change the header keeps its indicator until the
  // refreshed request lands (settling), without disabling the actions.
  const { run: runSettle, isPending: isSettling } = usePendingTask();
  const waitForChange = useSettleOnChange(request);
  const { showBanner } = useBanner();

  function markSettling(): void {
    void runSettle(waitForChange);
  }

  const context: DetailActionContext = {
    requestId: request.id,
    runPendingTask,
    showBanner,
    router,
    markSettling,
  };
  const match = useRequestMatch(context);
  // Failures render where the action was taken: header, customer card, dialog.
  const [headerError, setHeaderError] = useState<string | null>(null);
  const customer = useCustomerCardActions(request, hasCallerMatches, context);
  const { shownStatus, handleStatusToggle } = useRequestStatusToggle({
    request,
    context,
    runSettle,
    waitForChange,
    setHeaderError,
  });

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

  return {
    isPending,
    isSettling,
    shownStatus,
    headerError,
    markSettling,
    handleStatusToggle,
    handleReopen,
    ...customer,
    ...match,
  };
}
