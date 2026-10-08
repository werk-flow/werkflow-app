'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { WORK_DEPENDENCY_EFFECT_LABELS, type WorkDependencyEffect } from '@/lib/work-lifecycle/types';
import {
  useWorkLifecycleDependencyForm,
  type WorkDependencyDialogProps,
} from './use-work-lifecycle-dependency-form';

export function WorkDependencyDialog(props: WorkDependencyDialogProps) {
  const { snapshot, onClose } = props;
  const {
    type,
    setType,
    predecessor,
    setPredecessor,
    effect,
    setEffect,
    description,
    setDescription,
    remoteOptions,
    setRemoteOptions,
    setSearch,
    error,
    pending,
    searching,
    attempted,
    fieldErrors,
    submit,
  } = useWorkLifecycleDependencyForm(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={pending}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Voraussetzung hinzufügen</DialogTitle>
            <DialogDescription>
              Verknüpfe bestehende Arbeit oder erfasse eine klar bezeichnete externe Voraussetzung.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Art" htmlFor="dependency-type">
              <Select
                value={type}
                onValueChange={(value) => {
                  setType(value as typeof type);
                  setPredecessor('');
                  setRemoteOptions(null);
                  setSearch('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job">Auftrag</SelectItem>
                  <SelectItem value="project">Projekt</SelectItem>
                  <SelectItem value="instruction">Aufgabe / Checklistenpunkt</SelectItem>
                  <SelectItem value="declared">Deklarierte Voraussetzung</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Voraussetzung"
              htmlFor="dependency-target"
              required
              error={attempted ? fieldErrors['dependency-target'] : undefined}
            >
              <SearchableSelect
                options={remoteOptions ?? snapshot.predecessorOptions[type]}
                value={predecessor}
                onChange={setPredecessor}
                onSearchChange={(value) => {
                  setSearch(value);
                  if (value.trim().length < 2) setRemoteOptions(null);
                }}
                placeholder="Voraussetzung auswählen"
                searchPlaceholder="Voraussetzung suchen…"
                emptyMessage={searching ? 'Suche läuft…' : 'Keine passende Voraussetzung'}
              />
            </Field>
            {type === 'declared' && (
              <Field
                label="Konkrete Bedingung"
                htmlFor="dependency-description"
                required
                error={attempted ? fieldErrors['dependency-description'] : undefined}
              >
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={1000}
                  required
                />
              </Field>
            )}
            <Field label="Auswirkung" htmlFor="dependency-effect">
              <Select value={effect} onValueChange={(value) => setEffect(value as WorkDependencyEffect)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WORK_DEPENDENCY_EFFECT_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button pending={pending} type="submit" disabled={pending}>
              Hinzufügen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
