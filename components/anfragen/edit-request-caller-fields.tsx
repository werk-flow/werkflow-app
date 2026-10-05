'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { EditRequestForm } from './use-edit-request-form';

/** Captured caller data of a request that has no customer yet. */
export function EditRequestCallerFields({ form }: { form: EditRequestForm }) {
  const {
    callerName,
    setCallerName,
    callerPhone,
    setCallerPhone,
    callerEmail,
    setCallerEmail,
    callerAddress,
    setCallerAddress,
    isLoading,
  } = form;

  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Anrufer/in (noch kein Kunde)
      </p>
      <Field label="Name" htmlFor="edit-caller-name">
        <Input value={callerName} onChange={(e) => setCallerName(e.target.value)} disabled={isLoading} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Telefon" htmlFor="edit-caller-phone">
          <Input
            type="tel"
            value={callerPhone}
            onChange={(e) => setCallerPhone(e.target.value)}
            disabled={isLoading}
          />
        </Field>
        <Field label="E-Mail" htmlFor="edit-caller-email">
          <Input
            type="text"
            inputMode="email"
            value={callerEmail}
            onChange={(e) => setCallerEmail(e.target.value)}
            disabled={isLoading}
          />
        </Field>
      </div>
      <Field label="Adresse" htmlFor="edit-caller-address">
        <Input
          value={callerAddress}
          onChange={(e) => setCallerAddress(e.target.value)}
          disabled={isLoading}
        />
      </Field>
    </div>
  );
}
