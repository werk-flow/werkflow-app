'use client';

import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { WorkTemplateTargetType } from '@/lib/work-templates/types';

import type { CreateTemplateInput } from './work-template-editor-shared';

// Closes on submit; the owner renders the optimistic row and reports the outcome.
export function CreateTemplateDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateTemplateInput) => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetType, setTargetType] = useState<WorkTemplateTargetType>('job');
  const [error, setError] = useState<string | null>(null);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Bitte gib einen Namen an.');
      document.getElementById('new-template-name')?.focus();
      return;
    }
    onCreate({ name, description, targetType });
    setName('');
    setDescription('');
    setTargetType('job');
    setError(null);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Arbeitsvorlage erstellen</DialogTitle>
            <DialogDescription>
              Lege zuerst Ziel und Namen fest. Inhalte ergänzt du im nächsten Schritt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name" htmlFor="new-template-name" required error={error}>
              <Input
                autoFocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <Field label="Gilt für" htmlFor="new-template-target">
              <Select
                value={targetType}
                onValueChange={(value) => setTargetType(value as WorkTemplateTargetType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job">Aufträge</SelectItem>
                  <SelectItem value="project">Projekte</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Beschreibung" htmlFor="new-template-description">
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
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
