'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import type { TeamManagementController } from './use-team-management';

type TeamManagementCreateFormProps = {
  management: TeamManagementController;
};

export function TeamManagementCreateForm({ management }: TeamManagementCreateFormProps) {
  const { name, setName, description, setDescription, nameError, createError, anyBusy, handleCreate } =
    management;
  return (
    <section className="space-y-3" aria-labelledby="team-create-heading">
      <div>
        <h2 id="team-create-heading" className="text-sm font-semibold">
          Team anlegen
        </h2>
        <p className="text-sm text-muted-foreground">
          Teams gruppieren Mitarbeiter für die Planung. Sie ändern keine Berechtigungen.
        </p>
      </div>
      <Card className="grid gap-3 p-4 md:grid-cols-[1fr_1.5fr_auto]">
        <Field label="Name" htmlFor="new-team-name" required error={nameError} className="min-w-0 gap-1.5">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. Kundendienst"
            maxLength={120}
          />
        </Field>
        <Field label="Beschreibung (optional)" htmlFor="new-team-description" className="min-w-0 gap-1.5">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Kurzer operativer Zweck"
            className="min-h-9 min-w-0"
            maxLength={1000}
          />
        </Field>
        <Button type="button" className="self-end" onClick={() => void handleCreate()} disabled={anyBusy}>
          <Plus className="size-4" />
          Team anlegen
        </Button>
        <div className="md:col-span-3">
          <ErrorText>{createError}</ErrorText>
        </div>
      </Card>
    </section>
  );
}
