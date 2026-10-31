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
import { filterByQuery } from '@/lib/ui/search';
import {
  WORK_DEPENDENCY_EFFECT_LABELS,
  WORK_DEPENDENCY_EFFECTS,
  type WorkDependencyEffect,
} from '@/lib/work-lifecycle/types';
import {
  useWorkLifecycleDependencyForm,
  WORK_DEPENDENCY_PREDECESSOR_TYPES,
  type WorkDependencyDialogProps,
} from './use-work-lifecycle-dependency-form';

type WorkLifecycleDependencyForm = ReturnType<typeof useWorkLifecycleDependencyForm>;

/** The „Art“ select: a new kind clears the chosen predecessor and its search. */
function DependencyTypeField({
  type,
  setType,
  setPredecessor,
  setSearch,
}: Pick<WorkLifecycleDependencyForm, 'type' | 'setType' | 'setPredecessor' | 'setSearch'>) {
  return (
    <Field label="Art" htmlFor="dependency-type">
      <Select
        value={type}
        onValueChange={(value) => {
          const nextType = WORK_DEPENDENCY_PREDECESSOR_TYPES.find((candidate) => candidate === value);
          if (!nextType) return;
          setType(nextType);
          setPredecessor('');
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
  );
}

function DependencyEffectField({
  effect,
  setEffect,
}: {
  effect: WorkDependencyEffect;
  setEffect: (effect: WorkDependencyEffect) => void;
}) {
  return (
    <Field label="Auswirkung" htmlFor="dependency-effect">
      <Select
        value={effect}
        onValueChange={(value) => {
          const nextEffect = WORK_DEPENDENCY_EFFECTS.find((candidate) => candidate === value);
          if (nextEffect) setEffect(nextEffect);
        }}
      >
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
  );
}

/** Below two characters the snapshot's first choices are filtered here; above, the server searches. */
function DependencyPredecessorField({
  form,
  snapshot,
}: {
  form: WorkLifecycleDependencyForm;
  snapshot: WorkDependencyDialogProps['snapshot'];
}) {
  const { type, predecessor, setPredecessor, remoteOptions, search, setSearch } = form;
  return (
    <Field
      label="Voraussetzung"
      htmlFor="dependency-target"
      required
      error={form.attempted ? form.fieldErrors['dependency-target'] : undefined}
    >
      <SearchableSelect
        options={
          remoteOptions ??
          filterByQuery(snapshot.predecessorOptions[type], search, (option) =>
            option.description ? `${option.label} ${option.description}` : option.label,
          )
        }
        value={predecessor}
        onChange={setPredecessor}
        onSearchChange={setSearch}
        loadFailure={form.searchFailure}
        placeholder="Voraussetzung auswählen"
        searchPlaceholder="Voraussetzung suchen…"
        emptyMessage={form.searching ? 'Suche läuft…' : 'Keine passende Voraussetzung'}
      />
    </Field>
  );
}

export function WorkDependencyDialog(props: WorkDependencyDialogProps) {
  const { snapshot, onClose } = props;
  const form = useWorkLifecycleDependencyForm(props);
  const { type, setType, setPredecessor, effect, setEffect, description, setDescription, setSearch } = form;
  const { error, pending, attempted, fieldErrors, submit } = form;
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
            <DependencyTypeField
              type={type}
              setType={setType}
              setPredecessor={setPredecessor}
              setSearch={setSearch}
            />
            <DependencyPredecessorField form={form} snapshot={snapshot} />
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
            <DependencyEffectField effect={effect} setEffect={setEffect} />
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
