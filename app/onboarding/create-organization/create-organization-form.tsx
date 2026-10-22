'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { loadDocument } from '@/lib/navigation/document-load';
import { createOrganization } from '@/lib/org/actions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  name_required: 'Bitte gib einen Namen ein.',
  name_too_short: 'Der Name muss mindestens 2 Zeichen lang sein.',
  name_too_long: 'Der Name darf maximal 100 Zeichen lang sein.',
  name_taken: 'Du hast bereits eine Organisation mit diesem Namen.',
  subscription_required: 'Du benötigst ein aktives Abonnement.',
  organization_creation_failed: 'Organisation konnte nicht erstellt werden.',
  member_creation_failed: 'Mitgliedschaft konnte nicht erstellt werden.',
};

export function CreateOrganizationForm() {
  const [name, setName] = useState('');
  const { run: runCreate, isPending: isLoading } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const missingName = name.trim().length >= 2 ? undefined : ERROR_MESSAGES.name_too_short;
    setNameError(missingName ?? null);
    if (focusFirstInvalidField({ 'org-name': missingName })) return;

    await runCreate(async () => {
      try {
        const result = await createOrganization(name);

        if (result.success) {
          // A full load so the new page reads the new active-organization cookie.
          loadDocument(`/dashboard?created=${result.organizationId}`);
          return untilPageLeaves();
        }
        setError(describeFailure(result.error, ERROR_MESSAGES, SHARED_FAILURE_MESSAGES.unexpected_error));
      } catch {
        setError(SHARED_FAILURE_MESSAGES.unexpected_error);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Name der Organisation" htmlFor="org-name" required error={nameError}>
        <Input
          type="text"
          placeholder="z.B. Meine Firma GmbH"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          disabled={isLoading}
          autoComplete="organization"
        />
      </Field>

      <ErrorText>{error}</ErrorText>

      <Button type="submit" className="w-full" pending={isLoading}>
        {isLoading ? 'Wird erstellt…' : 'Organisation erstellen'}
      </Button>
    </form>
  );
}
