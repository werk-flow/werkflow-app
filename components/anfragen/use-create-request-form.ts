'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { useSuggestedRecordNumber } from '@/hooks/use-suggested-record-number';
import { describeFailure } from '@/lib/action-messages';
import { formatBerlinDateTimeInput, parseBerlinDateTimeInput } from '@/lib/date-time/berlin';
import { createClientRequest, type CreateClientRequestInput } from '@/lib/requests/actions';
import type { RequestCategory, RequestSource, RequestUrgency } from '@/lib/requests/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

export const SUMMARY_REQUIRED_MESSAGE = 'Bitte beschreibe kurz das Anliegen.';
export const INVALID_RECEIVED_AT_MESSAGE = 'Bitte gib eine gültige Eingangszeit ein.';
const INVALID_CALLBACK_DUE_AT_MESSAGE = 'Bitte gib eine gültige Rückrufzeit ein.';

/** The Anlage refusals of capture and edit, shared by both dialogs. */
export const REQUEST_EQUIPMENT_ERROR_MESSAGES = {
  invalid_callback_due_at: INVALID_CALLBACK_DUE_AT_MESSAGE,
  equipment_not_found: 'Die Anlage wurde nicht gefunden.',
  equipment_requires_site: 'Wähle zuerst den Einsatzort der Anlage.',
  equipment_client_mismatch: 'Die Anlage gehört zu einem anderen Kunden.',
  equipment_site_mismatch: 'Die Anlage gehört zu einem anderen Einsatzort.',
  equipment_not_active: 'Die Anlage ist archiviert. Wähle eine aktive Anlage.',
} satisfies Record<string, string>;

const ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Anfragen zu verwalten.',
  summary_required: SUMMARY_REQUIRED_MESSAGE,
  request_number_taken: 'Diese Anfragenummer ist bereits vergeben.',
  invalid_received_at: INVALID_RECEIVED_AT_MESSAGE,
  client_not_found: 'Der Kunde wurde nicht gefunden.',
  create_failed: 'Fehler beim Speichern der Anfrage.',
  ...REQUEST_EQUIPMENT_ERROR_MESSAGES,
} satisfies Record<string, string>;

type RequestFieldChecks = {
  /** Keyed by control id in visual order, for focusFirstInvalidField. */
  errors: Record<string, string | undefined>;
  summaryError: string | null;
  receivedAtError: string | null;
  callbackDueAtError: string | null;
  /** The submit-level message: `error` unless a field shows it. */
  formError: string | null;
  receivedAtDate: Date | null;
  callbackDueAtDate: Date | null;
};

/**
 * The summary, received-at and callback checks of the create and edit
 * dialogs. A field shows its own check after a submit attempt, else a server
 * refusal with the same message. A date without a time is the only
 * unparsable time value, so its error focuses the time control.
 */
export function checkRequestFields({
  idPrefix,
  summary,
  receivedAt,
  callbackDueAt,
  attempted,
  error,
}: {
  idPrefix: 'request' | 'edit-request';
  summary: string;
  receivedAt: string;
  callbackDueAt: string;
  attempted: boolean;
  error: string | null;
}): RequestFieldChecks {
  const summaryMessage = summary.trim() ? undefined : SUMMARY_REQUIRED_MESSAGE;
  const receivedAtDate = receivedAt ? parseBerlinDateTimeInput(receivedAt) : null;
  const receivedAtMessage = receivedAt && !receivedAtDate ? INVALID_RECEIVED_AT_MESSAGE : undefined;
  const callbackDueAtDate = callbackDueAt ? parseBerlinDateTimeInput(callbackDueAt) : null;
  const callbackDueAtMessage =
    callbackDueAt && !callbackDueAtDate ? INVALID_CALLBACK_DUE_AT_MESSAGE : undefined;
  const fieldError = (message: string | undefined, fieldMessage: string): string | null =>
    (attempted && message) || (error === fieldMessage ? error : null);
  const isFieldMessage =
    error === SUMMARY_REQUIRED_MESSAGE ||
    error === INVALID_RECEIVED_AT_MESSAGE ||
    error === INVALID_CALLBACK_DUE_AT_MESSAGE;
  return {
    errors: {
      [`${idPrefix}-summary`]: summaryMessage,
      [`${idPrefix}-received-at-time`]: receivedAtMessage,
      [`${idPrefix}-callback-time`]: callbackDueAtMessage,
    },
    summaryError: fieldError(summaryMessage, SUMMARY_REQUIRED_MESSAGE),
    receivedAtError: fieldError(receivedAtMessage, INVALID_RECEIVED_AT_MESSAGE),
    callbackDueAtError: fieldError(callbackDueAtMessage, INVALID_CALLBACK_DUE_AT_MESSAGE),
    formError: isFieldMessage ? null : error,
    receivedAtDate,
    callbackDueAtDate,
  };
}

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
  /** A new site drops the Anlage of the previous one. */
  handleSiteChange: (siteId: string) => void;
  equipmentId: string;
  setEquipmentId: (equipmentId: string) => void;
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
  /** „Rückruf bis“ as `YYYY-MM-DDTHH:mm` in Berlin time; empty without a promise. */
  callbackDueAt: string;
  setCallbackDueAt: (callbackDueAt: string) => void;
  assignedTo: string;
  setAssignedTo: (assignedTo: string) => void;
  isLoading: boolean;
  summaryError: string | null;
  receivedAtError: string | null;
  callbackDueAtError: string | null;
  formError: string | null;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
}

/** The fields the intake dialog edits, with their change handlers. */
type IntakeFields = Omit<
  CreateRequestForm,
  | 'open'
  | 'handleOpenChange'
  | 'isLoading'
  | 'summaryError'
  | 'receivedAtError'
  | 'callbackDueAtError'
  | 'formError'
  | 'handleSubmit'
>;

type IntakeCustomerFields = Pick<
  IntakeFields,
  | 'clientId'
  | 'handleClientChange'
  | 'siteId'
  | 'handleSiteChange'
  | 'equipmentId'
  | 'setEquipmentId'
  | 'contactId'
  | 'setContactId'
  | 'callerName'
  | 'setCallerName'
  | 'callerPhone'
  | 'setCallerPhone'
  | 'callerEmail'
  | 'setCallerEmail'
  | 'callerAddress'
  | 'setCallerAddress'
>;

/** The customer with site and contact, or the caller data while no customer is chosen. */
function useCreateRequestCustomerFields(): { fields: IntakeCustomerFields; resetFields: () => void } {
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [contactId, setContactId] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerEmail, setCallerEmail] = useState('');
  const [callerAddress, setCallerAddress] = useState('');

  const resetFields = () => {
    setClientId('');
    setSiteId('');
    setEquipmentId('');
    setContactId('');
    setCallerName('');
    setCallerPhone('');
    setCallerEmail('');
    setCallerAddress('');
  };

  const handleClientChange = (nextClientId: string) => {
    setClientId(nextClientId);
    setSiteId('');
    setEquipmentId('');
    setContactId('');
  };

  const handleSiteChange = (nextSiteId: string) => {
    setSiteId(nextSiteId);
    setEquipmentId('');
  };

  return {
    fields: {
      clientId,
      handleClientChange,
      siteId,
      handleSiteChange,
      equipmentId,
      setEquipmentId,
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
    },
    resetFields,
  };
}

/**
 * The intake fields; `applySuggestedNumber` never overwrites a number the user
 * typed. The capturing user owns the next step until someone else is chosen.
 */
function useCreateRequestFields(currentUserId: string): {
  fields: IntakeFields;
  resetFields: () => void;
  applySuggestedNumber: (suggestion: string) => void;
} {
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [requestNumber, setRequestNumber] = useState('');
  const requestNumberEditedRef = useRef(false);
  const customer = useCreateRequestCustomerFields();
  const [category, setCategory] = useState<RequestCategory>('sonstiges');
  const [urgency, setUrgency] = useState<RequestUrgency>('normal');
  const [source, setSource] = useState<RequestSource>('telefon');
  const [receivedAt, setReceivedAt] = useState(() => formatBerlinDateTimeInput(new Date()));
  const [callbackDueAt, setCallbackDueAt] = useState('');
  const [assignedTo, setAssignedTo] = useState(currentUserId);

  const resetFields = () => {
    requestNumberEditedRef.current = false;
    setSummary('');
    setDetails('');
    setRequestNumber('');
    customer.resetFields();
    setCategory('sonstiges');
    setUrgency('normal');
    setSource('telefon');
    setReceivedAt(formatBerlinDateTimeInput(new Date()));
    setCallbackDueAt('');
    setAssignedTo(currentUserId);
  };

  const handleRequestNumberChange = (nextRequestNumber: string) => {
    requestNumberEditedRef.current = true;
    setRequestNumber(nextRequestNumber);
  };

  const applySuggestedNumber = (suggestion: string) => {
    if (!requestNumberEditedRef.current) setRequestNumber((current) => current || suggestion);
  };

  return {
    fields: {
      summary,
      setSummary,
      details,
      setDetails,
      requestNumber,
      handleRequestNumberChange,
      ...customer.fields,
      category,
      setCategory,
      urgency,
      setUrgency,
      source,
      setSource,
      receivedAt,
      setReceivedAt,
      callbackDueAt,
      setCallbackDueAt,
      assignedTo,
      setAssignedTo,
    },
    resetFields,
    applySuggestedNumber,
  };
}

/** The action input: trimmed text, and only the optional values the user gave. */
function createRequestInput(
  fields: IntakeFields,
  receivedAtDate: Date | null,
  callbackDueAtDate: Date | null,
): CreateClientRequestInput {
  const { summary, details, requestNumber, clientId, siteId, equipmentId, contactId, assignedTo } = fields;
  const { callerName, callerPhone, callerEmail, callerAddress, category, urgency, source } = fields;
  return {
    summary: summary.trim(),
    ...(details.trim() ? { details: details.trim() } : {}),
    ...(requestNumber.trim() ? { requestNumber: requestNumber.trim() } : {}),
    ...(clientId ? { clientId } : {}),
    ...(siteId ? { siteId } : {}),
    ...(siteId && equipmentId ? { equipmentId } : {}),
    ...(contactId ? { contactId } : {}),
    ...(callerName.trim() ? { callerName: callerName.trim() } : {}),
    ...(callerPhone.trim() ? { callerPhone: callerPhone.trim() } : {}),
    ...(callerEmail.trim() ? { callerEmail: callerEmail.trim() } : {}),
    ...(callerAddress.trim() ? { callerAddress: callerAddress.trim() } : {}),
    category,
    urgency,
    source,
    ...(receivedAtDate ? { receivedAt: receivedAtDate.toISOString() } : {}),
    ...(callbackDueAtDate ? { callbackDueAt: callbackDueAtDate.toISOString() } : {}),
    ...(assignedTo ? { assignedTo } : {}),
  };
}

/** Form state of the intake dialog: number suggestion, reset on close, validation and save. */
export function useCreateRequestForm(currentUserId: string): CreateRequestForm {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [open, setOpen] = useState(false);

  const { fields, resetFields, applySuggestedNumber } = useCreateRequestFields(currentUserId);
  const { run: runCreate, isPending: isLoading } = useServerAction(createClientRequest);
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Suggest the next free number when the dialog opens; the field stays
  // editable. The suggestion must never overwrite a number the user has
  // already typed while the fetch was in flight.
  useSuggestedRecordNumber('next-request-number', open, applySuggestedNumber);

  const resetForm = () => {
    resetFields();
    setHasAttemptedSubmit(false);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      fields.setReceivedAt(formatBerlinDateTimeInput(new Date()));
    } else {
      resetForm();
    }
  };

  const checks = checkRequestFields({
    idPrefix: 'request',
    summary: fields.summary,
    receivedAt: fields.receivedAt,
    callbackDueAt: fields.callbackDueAt,
    attempted: hasAttemptedSubmit,
    error,
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    if (focusFirstInvalidField(checks.errors)) return;

    try {
      const input = createRequestInput(fields, checks.receivedAtDate, checks.callbackDueAtDate);

      const result = await runCreate(input);
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
    }
  };

  return {
    open,
    handleOpenChange,
    ...fields,
    isLoading,
    summaryError: checks.summaryError,
    receivedAtError: checks.receivedAtError,
    callbackDueAtError: checks.callbackDueAtError,
    formError: checks.formError,
    handleSubmit,
  };
}
