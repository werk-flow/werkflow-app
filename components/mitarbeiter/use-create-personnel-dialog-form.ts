'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { createPersonnelRecord, suggestPersonnelNumber } from '@/lib/personnel/actions';

const LAST_NAME_REQUIRED_MESSAGE = 'Bitte gib mindestens einen Nachnamen an.';
const CREATE_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  invalid_entry_date: 'Bitte gib ein gültiges Eintrittsdatum an.',
  number_taken: 'Diese Personalnummer ist bereits vergeben.',
  create_failed: 'Die Personalakte konnte nicht angelegt werden.',
};
const CREATE_FAILURE_FALLBACK = 'Die Personalakte konnte nicht angelegt werden.';

/** Open state, fields, number suggestion and save of the create-personnel dialog. */
export function useCreatePersonnelDialogForm() {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastNameError, setLastNameError] = useState<string | null>(null);

  // Guards for the async number suggestion: a suggestion must never overwrite
  // a number the user has already typed (see the P1-02 dialogs for the same
  // pattern; CodeRabbit caught the unguarded variant as a real defect).
  const numberTouchedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    suggestPersonnelNumber()
      .then((result) => {
        if (cancelled || numberTouchedRef.current) return;
        if (result.success) {
          setEmployeeNumber(result.number);
        }
      })
      // eslint-disable-next-line no-restricted-syntax -- the suggestion is a convenience; manual entry stays possible
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open]);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setEmployeeNumber('');
    setEntryDate('');
    setNotes('');
    setError(null);
    setLastNameError(null);
    numberTouchedRef.current = false;
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (lastName.trim().length === 0) {
      setLastNameError(LAST_NAME_REQUIRED_MESSAGE);
      document.getElementById('personnel-last-name')?.focus();
      return;
    }

    setIsSaving(true);
    // A rejected Server Action shows the fallback and releases the dialog.
    const result = await createPersonnelRecord({
      ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
      lastName: lastName.trim(),
      ...(employeeNumber.trim() ? { employeeNumber: employeeNumber.trim() } : {}),
      ...(entryDate ? { entryDate } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }).catch(() => null);
    setIsSaving(false);
    if (!result) {
      setError(CREATE_FAILURE_FALLBACK);
      return;
    }

    if (result.success) {
      setOpen(false);
      resetForm();
      showBanner({
        variant: 'success',
        message: 'Die Personalakte wurde angelegt.',
      });
      router.push(`/mitarbeiter/${result.recordId}`);
    } else {
      setError(describeFailure(result.error, CREATE_FAILURE_MESSAGES, CREATE_FAILURE_FALLBACK));
    }
  };

  const handleLastNameChange = (value: string) => {
    setLastNameError(null);
    setLastName(value);
  };

  const handleEmployeeNumberChange = (value: string) => {
    numberTouchedRef.current = true;
    setEmployeeNumber(value);
  };

  return {
    open,
    firstName,
    setFirstName,
    lastName,
    handleLastNameChange,
    employeeNumber,
    handleEmployeeNumberChange,
    entryDate,
    setEntryDate,
    notes,
    setNotes,
    isSaving,
    error,
    lastNameError,
    handleOpenChange,
    handleSubmit,
  };
}
