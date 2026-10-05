'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { formatBerlinDateTimeInput, parseBerlinDateTimeInput } from '@/lib/customer-relationships/date-time';
import {
  createClientRequest,
  getNextRequestNumber,
  type CreateClientRequestInput,
} from '@/lib/requests/actions';
import type { RequestCategory, RequestSource, RequestUrgency } from '@/lib/requests/types';

const ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Anfragen zu verwalten.',
  summary_required: 'Bitte beschreibe kurz das Anliegen.',
  request_number_taken: 'Diese Anfragenummer ist bereits vergeben.',
  invalid_received_at: 'Bitte gib eine gültige Eingangszeit ein.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
  create_failed: 'Fehler beim Speichern der Anfrage.',
} satisfies Record<string, string>;

export interface CreateRequestForm {
  open: boolean;
  handleOpenChange: (nextOpen: boolean) => void;
  summary: string;
  setSummary: (summary: string) => void;
  details: string;
  setDetails: (details: string) => void;
  requestNumber: string;
  /** Marks the number as typed by the user so a late suggestion never replaces it. */
  handleRequestNumberChange: (requestNumber: string) => void;
  clientId: string;
  handleClientChange: (nextClientId: string) => void;
  siteId: string;
  setSiteId: (siteId: string) => void;
  contactId: string;
  setContactId: (contactId: string) => void;
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
  error: string | null;
  showSummaryError: boolean;
  showReceivedAtError: boolean;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
}

/** Form state of the intake dialog: number suggestion, reset on close, validation and save. */
export function useCreateRequestForm(): CreateRequestForm {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [open, setOpen] = useState(false);

  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [requestNumber, setRequestNumber] = useState('');
  const requestNumberEditedRef = useRef(false);
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [contactId, setContactId] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerEmail, setCallerEmail] = useState('');
  const [callerAddress, setCallerAddress] = useState('');
  const [category, setCategory] = useState<RequestCategory>('sonstiges');
  const [urgency, setUrgency] = useState<RequestUrgency>('normal');
  const [source, setSource] = useState<RequestSource>('telefon');
  const [receivedAt, setReceivedAt] = useState(() => formatBerlinDateTimeInput(new Date()));
  const [assignedTo, setAssignedTo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Suggest the next free number when the dialog opens; the field stays
  // editable. The suggestion must never overwrite a number the user has
  // already typed while the fetch was in flight.
  useEffect(() => {
    if (!open) return;
    let isCurrent = true;
    getNextRequestNumber()
      .then((result) => {
        if (isCurrent && result.success && !requestNumberEditedRef.current) {
          setRequestNumber((current) => current || result.requestNumber);
        }
      })
      // eslint-disable-next-line no-restricted-syntax -- the number suggestion is a convenience; the field stays empty and manual entry works
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [open]);

  const resetForm = () => {
    requestNumberEditedRef.current = false;
    setSummary('');
    setDetails('');
    setRequestNumber('');
    setClientId('');
    setSiteId('');
    setContactId('');
    setCallerName('');
    setCallerPhone('');
    setCallerEmail('');
    setCallerAddress('');
    setCategory('sonstiges');
    setUrgency('normal');
    setSource('telefon');
    setReceivedAt(formatBerlinDateTimeInput(new Date()));
    setAssignedTo('');
    setHasAttemptedSubmit(false);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setReceivedAt(formatBerlinDateTimeInput(new Date()));
    } else {
      resetForm();
    }
  };

  const handleClientChange = (nextClientId: string) => {
    setClientId(nextClientId);
    setSiteId('');
    setContactId('');
  };

  const handleRequestNumberChange = (nextRequestNumber: string) => {
    requestNumberEditedRef.current = true;
    setRequestNumber(nextRequestNumber);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);

    if (!summary.trim()) {
      document.getElementById('request-summary')?.focus();
      return;
    }

    const receivedAtDate = receivedAt ? parseBerlinDateTimeInput(receivedAt) : null;
    if (receivedAt && !receivedAtDate) {
      setError(ERROR_MESSAGES.invalid_received_at);
      // A date without a time is the only unparsable value the field can hold.
      document.getElementById('request-received-at-time')?.focus();
      return;
    }

    setIsLoading(true);
    try {
      const input: CreateClientRequestInput = {
        summary: summary.trim(),
        ...(details.trim() ? { details: details.trim() } : {}),
        ...(requestNumber.trim() ? { requestNumber: requestNumber.trim() } : {}),
        ...(clientId ? { clientId } : {}),
        ...(siteId ? { siteId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(callerName.trim() ? { callerName: callerName.trim() } : {}),
        ...(callerPhone.trim() ? { callerPhone: callerPhone.trim() } : {}),
        ...(callerEmail.trim() ? { callerEmail: callerEmail.trim() } : {}),
        ...(callerAddress.trim() ? { callerAddress: callerAddress.trim() } : {}),
        category,
        urgency,
        source,
        ...(receivedAtDate ? { receivedAt: receivedAtDate.toISOString() } : {}),
        ...(assignedTo ? { assignedTo } : {}),
      };

      const result = await createClientRequest(input);
      if (!result.success) {
        setError(describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler'));
        return;
      }

      handleOpenChange(false);
      showBanner({ variant: 'success', message: 'Anfrage wurde erfasst.' });
      router.push(`/anfragen/${result.request.id}`);
      router.refresh();
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const showSummaryError = hasAttemptedSubmit && !summary.trim();
  const showReceivedAtError = error === ERROR_MESSAGES.invalid_received_at;

  return {
    open,
    handleOpenChange,
    summary,
    setSummary,
    details,
    setDetails,
    requestNumber,
    handleRequestNumberChange,
    clientId,
    handleClientChange,
    siteId,
    setSiteId,
    contactId,
    setContactId,
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
    error,
    showSummaryError,
    showReceivedAtError,
    handleSubmit,
  };
}
