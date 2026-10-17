'use client';

import { useRef, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSuggestedRecordNumber } from '@/hooks/use-suggested-record-number';
import { describeFailure } from '@/lib/action-messages';
import { convertRequestToJob, convertRequestToProject } from '@/lib/requests/actions';
import { requestUrgencyToJobPriority, type ClientRequest } from '@/lib/requests/types';
import type { JobPriority } from '@/lib/jobs/types';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Anfragen umzuwandeln.',
  request_not_found: 'Die Anfrage wurde nicht gefunden.',
  already_converted: 'Diese Anfrage wurde bereits umgewandelt.',
  client_required: 'Bitte wähle einen Kunden aus oder lege ihn an.',
  job_number_required: 'Bitte gib eine Auftragsnummer ein.',
  job_number_taken: 'Diese Auftragsnummer ist bereits vergeben.',
  project_number_taken: 'Diese Projektnummer ist bereits vergeben.',
  title_or_description_required: 'Bitte gib einen Titel ein.',
  name_required: 'Bitte gib einen Projektnamen ein.',
  create_failed: 'Die Umwandlung ist fehlgeschlagen.',
  work_template_version_unavailable: 'Die gewählte Arbeitsvorlage ist nicht mehr verfügbar.',
  work_template_reference_unavailable: 'Die Arbeitsvorlage verweist auf nicht mehr aktive Stammdaten.',
  template_apply_failed: 'Die Arbeitsvorlage konnte nicht übernommen werden.',
} satisfies Record<string, string>;

export type ConversionTarget = 'job' | 'project';

type ConversionFieldId = 'convert-title' | 'convert-number' | 'convert-client';

// The server refusals that name a field show on that field.
const FIELD_SERVER_MESSAGES: Record<ConversionFieldId, readonly string[]> = {
  'convert-title': [ERROR_MESSAGES.title_or_description_required, ERROR_MESSAGES.name_required],
  'convert-number': [
    ERROR_MESSAGES.job_number_required,
    ERROR_MESSAGES.job_number_taken,
    ERROR_MESSAGES.project_number_taken,
  ],
  'convert-client': [ERROR_MESSAGES.client_required],
};

/** The dialog's field checks in visual order, keyed by control id. */
function conversionFieldErrors(
  target: ConversionTarget,
  title: string,
  number: string,
  clientId: string,
): Record<ConversionFieldId, string | undefined> {
  const titleMessage =
    target === 'job' ? ERROR_MESSAGES.title_or_description_required : ERROR_MESSAGES.name_required;
  return {
    'convert-title': title.trim() ? undefined : titleMessage,
    'convert-number': target === 'job' && !number.trim() ? ERROR_MESSAGES.job_number_required : undefined,
    'convert-client': clientId ? undefined : ERROR_MESSAGES.client_required,
  };
}

/** A field's message: its own check after a submit attempt, else a server refusal that names it. */
function conversionFieldError(
  id: ConversionFieldId,
  fieldErrors: Record<ConversionFieldId, string | undefined>,
  attempted: boolean,
  error: string | null,
): string | null {
  const ownMessage = attempted ? fieldErrors[id] : undefined;
  if (ownMessage) return ownMessage;
  return error !== null && FIELD_SERVER_MESSAGES[id].includes(error) ? error : null;
}

export interface ConvertRequestForm {
  target: ConversionTarget;
  setTarget: (target: ConversionTarget) => void;
  title: string;
  setTitle: (title: string) => void;
  description: string;
  setDescription: (description: string) => void;
  number: string;
  setNumber: (number: string) => void;
  clientId: string;
  setClientId: (clientId: string) => void;
  siteId: string;
  setSiteId: (siteId: string) => void;
  contactId: string;
  setContactId: (contactId: string) => void;
  priority: JobPriority;
  setPriority: (priority: JobPriority) => void;
  plannedDate: string;
  setPlannedDate: (plannedDate: string) => void;
  plannedTime: string;
  setPlannedTime: (plannedTime: string) => void;
  location: string;
  setLocation: (location: string) => void;
  templateVersionId: string;
  setTemplateVersionId: (templateVersionId: string) => void;
  qualificationWarning: AssignmentEvaluation | null;
  setQualificationWarning: (evaluation: AssignmentEvaluation | null) => void;
  isLoading: boolean;
  titleError: string | null;
  numberError: string | null;
  clientError: string | null;
  formError: string | null;
  submitConversion: (approval?: AssignmentApproval) => Promise<void>;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
}

/** The number field, prefilled with the next free job or project number while the dialog is open. */
function useSuggestedConversionNumber(
  open: boolean,
  target: ConversionTarget,
): { number: string; setNumber: (number: string) => void } {
  const [number, setNumber] = useState('');
  const lastSuggestedNumberRef = useRef('');
  // Each opening starts empty, so the fresh suggestion fills the field like the
  // other fields reset; a target switch while open keeps a number the user typed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNumber('');
  }

  // Apply the suggestion only when the field is empty or still holds a
  // previous suggestion — never overwrite a number the user typed.
  useSuggestedRecordNumber(target === 'job' ? 'next-job-number' : 'next-project-number', open, (suggestion) =>
    setNumber((current) => {
      if (current && current !== lastSuggestedNumberRef.current) {
        return current;
      }
      lastSuggestedNumberRef.current = suggestion;
      return suggestion;
    }),
  );

  return { number, setNumber };
}

/** Form state of the conversion dialog: prefill, number suggestion, validation and submit. */
export function useConvertRequestForm({
  request,
  open,
  onOpenChange,
  onSaved,
}: {
  request: ClientRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (() => void) | undefined;
}): ConvertRequestForm {
  const { showBanner } = useBanner();
  const [target, setTarget] = useState<ConversionTarget>('job');
  const [title, setTitle] = useState(request.summary);
  const [description, setDescription] = useState(request.details ?? '');
  const [clientId, setClientId] = useState(request.clientId ?? '');
  const [siteId, setSiteId] = useState(request.siteId ?? '');
  const [contactId, setContactId] = useState(request.contactId ?? '');
  const [priority, setPriority] = useState<JobPriority>(requestUrgencyToJobPriority(request.urgency));
  const [plannedDate, setPlannedDate] = useState('');
  const [plannedTime, setPlannedTime] = useState('');
  const [location, setLocation] = useState('');
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const { run: runConvert, isPending: isLoading } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // Prefill from the request each time the dialog opens, during render and
  // never in an effect. Keyed on open and request.id only: Realtime refreshes
  // replace the request object with equal content, and a refill would wipe the
  // user's in-dialog edits.
  const [prefilledFor, setPrefilledFor] = useState({ open: false, requestId: request.id });
  if (open !== prefilledFor.open || request.id !== prefilledFor.requestId) {
    setPrefilledFor({ open, requestId: request.id });
    if (open) {
      setTitle(request.summary);
      setDescription(request.details ?? '');
      setClientId(request.clientId ?? '');
      setSiteId(request.siteId ?? '');
      setContactId(request.contactId ?? '');
      setPriority(requestUrgencyToJobPriority(request.urgency));
      setPlannedDate('');
      setPlannedTime('');
      setLocation('');
      setTemplateVersionId('');
      setError(null);
      setAttempted(false);
    }
  }

  const { number, setNumber } = useSuggestedConversionNumber(open, target);

  const fieldErrors = conversionFieldErrors(target, title, number, clientId);

  // A template belongs to one target kind, so switching the target clears it.
  const changeTarget = (nextTarget: ConversionTarget) => {
    if (nextTarget === target) return;
    setTarget(nextTarget);
    setTemplateVersionId('');
  };

  const submitConversion = async (approval?: AssignmentApproval) => {
    setError(null);
    // Close the warning first: it would otherwise stay open over a failure
    // message, and over the closed form after a success.
    setQualificationWarning(null);

    setAttempted(true);
    if (focusFirstInvalidField(fieldErrors)) return;

    await runConvert(async () => {
      try {
        if (target === 'job') {
          const result = await convertRequestToJob(request.id, {
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            clientId,
            ...(siteId ? { siteId } : {}),
            ...(contactId ? { contactId } : {}),
            jobNumber: number.trim(),
            priority,
            ...(plannedDate ? { plannedDate } : {}),
            // The time field hides without a date; a parked job carries no time.
            ...(plannedDate && plannedTime ? { plannedTime } : {}),
            ...(location.trim() ? { location: location.trim() } : {}),
            ...(templateVersionId ? { templateVersionId } : {}),
            assignmentApproval: approval ?? null,
          });
          if (!result.success) {
            if (
              (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
              'evaluation' in result
            ) {
              setQualificationWarning(result.evaluation);
              return;
            }
            setError(describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler'));
            return;
          }
          onOpenChange(false);
          onSaved?.();
          showBanner({
            variant: 'success',
            message: 'Anfrage wurde in einen Auftrag umgewandelt.',
          });
        } else {
          const result = await convertRequestToProject(request.id, {
            name: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            clientId,
            ...(siteId ? { siteId } : {}),
            ...(contactId ? { contactId } : {}),
            ...(number.trim() ? { projectNumber: number.trim() } : {}),
            ...(templateVersionId ? { templateVersionId } : {}),
          });
          if (!result.success) {
            setError(describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler'));
            return;
          }
          onOpenChange(false);
          onSaved?.();
          showBanner({
            variant: 'success',
            message: 'Anfrage wurde in ein Projekt umgewandelt.',
          });
        }
      } catch {
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      }
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitConversion();
  };

  const titleError = conversionFieldError('convert-title', fieldErrors, attempted, error);
  const numberError = conversionFieldError('convert-number', fieldErrors, attempted, error);
  const clientError = conversionFieldError('convert-client', fieldErrors, attempted, error);
  // A server refusal shows once: on the field it names, else above the actions.
  const formError = [titleError, numberError, clientError].includes(error) ? null : error;

  return {
    target,
    setTarget: changeTarget,
    title,
    setTitle,
    description,
    setDescription,
    number,
    setNumber,
    clientId,
    setClientId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    priority,
    setPriority,
    plannedDate,
    setPlannedDate,
    plannedTime,
    setPlannedTime,
    location,
    setLocation,
    templateVersionId,
    setTemplateVersionId,
    qualificationWarning,
    setQualificationWarning,
    isLoading,
    titleError,
    numberError,
    clientError,
    formError,
    submitConversion,
    handleSubmit,
  };
}
