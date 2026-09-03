'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserRoundPlus } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import {
  createPersonnelRecord,
  suggestPersonnelNumber,
} from '@/lib/personnel/actions';
import { toLocalDateString } from '@/lib/utils';

const ERROR_MESSAGES: Record<string, string> = {
  last_name_required: 'Bitte gib mindestens einen Nachnamen an.',
  invalid_entry_date: 'Bitte gib ein gültiges Eintrittsdatum an.',
  number_taken: 'Diese Personalnummer ist bereits vergeben.',
  not_authorized: 'Du bist nicht berechtigt, Personalakten anzulegen.',
  create_failed: 'Die Personalakte konnte nicht angelegt werden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

export function CreatePersonnelDialog() {
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
      .catch(() => {
        // Suggestion is a convenience; manual entry stays possible.
      });

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
    if (isSaving) return;
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (lastName.trim().length === 0) {
      setLastNameError(ERROR_MESSAGES.last_name_required);
      document.getElementById('personnel-last-name')?.focus();
      return;
    }

    setIsSaving(true);
    const result = await createPersonnelRecord({
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim(),
      employeeNumber: employeeNumber.trim() || undefined,
      entryDate: entryDate || undefined,
      notes: notes.trim() || undefined,
    });
    setIsSaving(false);

    if (result.success) {
      setOpen(false);
      resetForm();
      showBanner({
        variant: 'success',
        message: 'Die Personalakte wurde angelegt.',
      });
      router.push(`/mitarbeiter/${result.recordId}`);
    } else {
      setError(
        ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.unexpected_error
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="default" className="gap-2">
          <UserRoundPlus className="size-4" />
          <span className="hidden sm:inline">Personalakte anlegen</span>
          <span className="sm:hidden">Personalakte</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Personalakte anlegen</DialogTitle>
          <DialogDescription>
            Für zukünftige Mitarbeiter oder Personal ohne App-Zugang. Ein Zugang
            kann später über eine Einladung verknüpft werden.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vorname" htmlFor="personnel-first-name">
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={isSaving}
                />
              </Field>
              <Field
                label="Nachname"
                htmlFor="personnel-last-name"
                required
                error={lastNameError}
              >
                <Input
                  value={lastName}
                  onChange={(e) => {
                    setLastNameError(null);
                    setLastName(e.target.value);
                  }}
                  disabled={isSaving}
                />
              </Field>
            </div>
            <Field label="Personalnummer" htmlFor="personnel-number">
              <Input
                placeholder="z. B. MA-001"
                value={employeeNumber}
                onChange={(e) => {
                  numberTouchedRef.current = true;
                  setEmployeeNumber(e.target.value);
                }}
                disabled={isSaving}
              />
            </Field>
            <Field label="Eintrittsdatum" htmlFor="personnel-entry-date">
              <DatePicker
                ariaLabel="Eintrittsdatum"
                value={entryDate ? new Date(`${entryDate}T00:00:00`) : undefined}
                onChange={(date) =>
                  setEntryDate(date ? toLocalDateString(date) : '')
                }
                disabled={isSaving}
              />
            </Field>
            <Field label="Notizen" htmlFor="personnel-notes">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSaving}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird angelegt...' : 'Personalakte anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
