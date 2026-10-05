'use client';

import { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectWithCreate } from '@/components/ui/select-with-create';
import type { CapabilityDefinition, CapabilityKind } from '@/lib/qualifications/types';
import { cn } from '@/lib/utils';
import type { WorkTemplateDraft } from '@/lib/work-templates/types';

import { newId, type CreateCapabilityInput } from './work-template-editor-shared';

export function CapabilitiesEditor({
  draft,
  editable,
  onChange,
  capabilities,
  onCreateCapability,
  isCapabilityPending,
}: {
  draft: WorkTemplateDraft;
  editable: boolean;
  onChange: (draft: WorkTemplateDraft) => void;
  capabilities: CapabilityDefinition[];
  onCreateCapability: (lineId: string, input: CreateCapabilityInput) => void;
  isCapabilityPending: (capabilityId: string) => boolean;
}) {
  const titleId = useId();
  function add() {
    onChange({
      ...draft,
      capabilities: [
        ...draft.capabilities,
        { id: newId(), capabilityId: '', requireConfirmation: false, sortOrder: draft.capabilities.length },
      ],
    });
  }
  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <div className="flex items-center justify-between">
        <div>
          <h3 id={titleId} className="font-semibold">
            Geplante Qualifikationen
          </h3>
          <p className="text-sm text-muted-foreground">
            Bei Aufträgen fließen diese Anforderungen in die bestehende Besetzungsprüfung ein.
          </p>
        </div>
        {editable && (
          <Button type="button" size="sm" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Qualifikation
          </Button>
        )}
      </div>
      {draft.capabilities.map((line) => {
        const pending = isCapabilityPending(line.capabilityId);
        return (
          <div
            key={line.id}
            className={cn(
              'grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end',
              pending && 'opacity-70',
            )}
            aria-busy={pending || undefined}
            data-testid="work-template-capability"
            data-row-id={line.id}
          >
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  Qualifikation
                  <InlinePending active={pending} label="Qualifikation wird erstellt" />
                </span>
              }
              htmlFor={`capability-${line.id}`}
            >
              <SelectWithCreate
                id={`capability-${line.id}`}
                items={capabilities}
                getOption={(item) => ({
                  value: item.id,
                  label: item.name,
                  description: item.kind === 'skill' ? 'Fähigkeit' : 'Zertifizierung',
                })}
                value={line.capabilityId}
                onValueChange={(value) =>
                  onChange({
                    ...draft,
                    capabilities: draft.capabilities.map((item) =>
                      item.id === line.id ? { ...item, capabilityId: value } : item,
                    ),
                  })
                }
                createLabel="Neue Qualifikation erstellen"
                disabled={!editable}
                renderCreateDialog={({ open, onOpenChange }) => (
                  <CreateCapabilityDialog
                    open={open}
                    onOpenChange={onOpenChange}
                    onSubmit={(input) => onCreateCapability(line.id, input)}
                  />
                )}
              />
            </Field>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={line.requireConfirmation}
                disabled={!editable}
                onCheckedChange={(checked) =>
                  onChange({
                    ...draft,
                    capabilities: draft.capabilities.map((item) =>
                      item.id === line.id ? { ...item, requireConfirmation: checked === true } : item,
                    ),
                  })
                }
              />
              Bestätigung nötig
            </label>
            {editable && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...draft,
                    capabilities: draft.capabilities.filter((item) => item.id !== line.id),
                  })
                }
                aria-label="Qualifikation löschen"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}

// Closes on submit; the editor selects the optimistic qualification on the line and reports the outcome.
function CreateCapabilityDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateCapabilityInput) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CapabilityKind>('skill');
  const [error, setError] = useState<string | null>(null);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!name.trim()) {
      setError('Bitte gib einen Namen an.');
      document.getElementById('quick-capability-name')?.focus();
      return;
    }
    onSubmit({ name, kind });
    setName('');
    setError(null);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Qualifikation erstellen</DialogTitle>
            <DialogDescription>
              Erweitert den gemeinsamen Qualifikationskatalog der Organisation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name" htmlFor="quick-capability-name" required error={error}>
              <Input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <Field label="Art" htmlFor="quick-capability-kind">
              <Select value={kind} onValueChange={(value) => setKind(value as CapabilityKind)}>
                <SelectTrigger aria-label="Art der Qualifikation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skill">Fähigkeit</SelectItem>
                  <SelectItem value="certification">Zertifizierung</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit">Erstellen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
