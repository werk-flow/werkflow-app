'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { formatBerlinDateTimeInput } from '@/lib/date-time/berlin';
import { updateClientRequest } from '@/lib/requests/actions';
import type { ClientRequest, RequestCategory, RequestSource, RequestUrgency } from '@/lib/requests/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import {
  checkRequestFields,
  INVALID_RECEIVED_AT_MESSAGE,
  SUMMARY_REQUIRED_MESSAGE,
} from './use-create-request-form';

const ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Anfragen zu bearbeiten.',
  request_not_found: 'Die Anfrage wurde nicht gefunden.',
  request_not_editable:
    'Diese Anfrage kann nicht mehr bearbeitet werden (bereits umgewandelt oder geschlossen).',
  summary_required: SUMMARY_REQUIRED_MESSAGE,
  request_number_taken: 'Diese Anfragenummer ist bereits vergeben.',
  invalid_received_at: INVALID_RECEIVED_AT_MESSAGE,
  update_failed: 'Die Änderungen konnten nicht gespeichert werden.',
  no_changes: 'Es gibt keine Änderungen zu speichern.',
} satisfies Record<string, string>;

export interface EditRequestForm {
  summary: string;
  setSummary: (summary: string) => void;
  details: string;
  setDetails: (details: string) => void;
  requestNumber: string;
  setRequestNumber: (requestNumber: string) => void;
  callerName: string;
  setCallerName: (callerName: string) => void;
  callerPhone: string;
  setCallerPhone: (callerPhone: string) => void;
  callerEmail: string;
  setCallerEmail: (callerEmail: string) => void;
  callerAddress: string;
  setCallerAddress: (callerAddress: string) => void;
  category: RequestCategory;
  setCategory: (category: RequestCategory) => void;
  urgency: RequestUrgency;
  setUrgency: (urgency: RequestUrgency) => void;
  source: RequestSource;
  setSource: (source: RequestSource) => void;
  receivedAt: string;
  setReceivedAt: (receivedAt: string) => void;
  assignedTo: string;
  setAssignedTo: (assignedTo: string) => void;
  isLoading: boolean;
  summaryError: string | null;
  receivedAtError: string | null;
  formError: string | null;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
}

/** Form state of the edit dialog: prefill on open, validation and save. */
export function useEditRequestForm({
  request,
  open,
  onOpenChange,
  onSaved,
}: {
  request: ClientRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (() => void) | undefined;
}): EditRequestForm {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [summary, setSummary] = useState(request.summary);
  const [details, setDetails] = useState(request.details ?? '');
  const [requestNumber, setRequestNumber] = useState(request.requestNumber ?? '');
  const [callerName, setCallerName] = useState(request.callerName ?? '');
  const [callerPhone, setCallerPhone] = useState(request.callerPhone ?? '');
  const [callerEmail, setCallerEmail] = useState(request.callerEmail ?? '');
  const [callerAddress, setCallerAddress] = useState(request.callerAddress ?? '');
  const [category, setCategory] = useState<RequestCategory>(request.category);
  const [urgency, setUrgency] = useState<RequestUrgency>(request.urgency);
  const [source, setSource] = useState<RequestSource>(request.source);
  const [receivedAt, setReceivedAt] = useState(formatBerlinDateTimeInput(request.receivedAt));
  const [assignedTo, setAssignedTo] = useState(request.assignedTo ?? '');
  const { run: runUpdate, isPending: isLoading } = useServerAction(updateClientRequest);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // Refilled during render, never in an effect. Keyed on open and request.id
  // only: Realtime refreshes replace the request object with equal content, and
  // a refill would wipe edits.
  const [prefilledFor, setPrefilledFor] = useState({ open: false, requestId: request.id });
  if (open !== prefilledFor.open || request.id !== prefilledFor.requestId) {
    setPrefilledFor({ open, requestId: request.id });
    if (open) {
      setSummary(request.summary);
      setDetails(request.details ?? '');
      setRequestNumber(request.requestNumber ?? '');
      setCallerName(request.callerName ?? '');
      setCallerPhone(request.callerPhone ?? '');
      setCallerEmail(request.callerEmail ?? '');
      setCallerAddress(request.callerAddress ?? '');
      setCategory(request.category);
      setUrgency(request.urgency);
      setSource(request.source);
      setReceivedAt(formatBerlinDateTimeInput(request.receivedAt));
      setAssignedTo(request.assignedTo ?? '');
      setError(null);
      setAttempted(false);
    }
  }

  const { errors, summaryError, receivedAtError, formError, receivedAtDate } = checkRequestFields({
    idPrefix: 'edit-request',
    summary,
    receivedAt,
    attempted,
    error,
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setError(null);
    if (focusFirstInvalidField(errors)) return;

    try {
      const result = await runUpdate(request.id, {
        summary: summary.trim(),
        details,
        requestNumber,
        callerName,
        callerPhone,
        callerEmail,
        callerAddress,
        category,
        urgency,
        source,
        ...(receivedAtDate ? { receivedAt: receivedAtDate.toISOString() } : {}),
        assignedTo,
      });

      if (!result.success && result.error !== 'no_changes') {
        setError(describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler'));
        return;
      }

      onOpenChange(false);
      onSaved?.();
      showBanner({ variant: 'success', message: 'Änderungen gespeichert.' });
      router.refresh();
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    }
  };

  return {
    summary,
    setSummary,
    details,
    setDetails,
    requestNumber,
    setRequestNumber,
    callerName,
    setCallerName,
    callerPhone,
    setCallerPhone,
    callerEmail,
    setCallerEmail,
    callerAddress,
    setCallerAddress,
    category,
    setCategory,
    urgency,
    setUrgency,
    source,
    setSource,
    receivedAt,
    setReceivedAt,
    assignedTo,
    setAssignedTo,
    isLoading,
    summaryError,
    receivedAtError,
    formError,
    handleSubmit,
  };
}
