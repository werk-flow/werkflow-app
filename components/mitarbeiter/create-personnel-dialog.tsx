'use client';

import { UserRoundPlus } from 'lucide-react';

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
import { toLocalDateString } from '@/lib/utils';
import { useCreatePersonnelDialogForm } from './use-create-personnel-dialog-form';

export function CreatePersonnelDialog() {
  const {
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
  } = useCreatePersonnelDialogForm();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isSaving}>
      <DialogTrigger asChild>
        <Button variant="outline" size="default" className="gap-2">
          <UserRoundPlus className="size-4" />
          <span className="sr-only sm:not-sr-only">Personalakte anlegen</span>
          <span className="sm:hidden" aria-hidden="true">
            Personalakte
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent size="md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Personalakte anlegen</DialogTitle>
          <DialogDescription>
            Für zukünftige Mitarbeiter oder Personal ohne App-Zugang. Ein Zugang kann später über eine
            Einladung verknüpft werden.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vorname" htmlFor="personnel-first-name">
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={isSaving} />
              </Field>
              <Field label="Nachname" htmlFor="personnel-last-name" required error={lastNameError}>
                <Input
                  value={lastName}
                  onChange={(e) => handleLastNameChange(e.target.value)}
                  disabled={isSaving}
                />
              </Field>
            </div>
            <Field label="Personalnummer" htmlFor="personnel-number">
              <Input
                placeholder="z. B. MA-001"
                value={employeeNumber}
                onChange={(e) => handleEmployeeNumberChange(e.target.value)}
                disabled={isSaving}
              />
            </Field>
            <Field label="Eintrittsdatum" htmlFor="personnel-entry-date">
              <DatePicker
                ariaLabel="Eintrittsdatum"
                value={entryDate ? new Date(`${entryDate}T00:00:00`) : undefined}
                onChange={(date) => setEntryDate(date ? toLocalDateString(date) : '')}
                disabled={isSaving}
              />
            </Field>
            <Field label="Notizen" htmlFor="personnel-notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button pending={isSaving} type="submit" disabled={isSaving}>
              {isSaving ? 'Wird angelegt…' : 'Personalakte anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
