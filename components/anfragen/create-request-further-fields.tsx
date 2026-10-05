'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { REQUEST_SOURCE_LABELS, REQUEST_SOURCE_ORDER, type RequestSource } from '@/lib/requests/types';
import type { CreateRequestForm } from './use-create-request-form';

interface CreateRequestFurtherFieldsProps {
  assignees: Array<{ userId: string; name: string }>;
  form: CreateRequestForm;
}

/** Details, intake channel, request number and the responsible person. */
export function CreateRequestFurtherFields({ assignees, form }: CreateRequestFurtherFieldsProps) {
  const {
    details,
    setDetails,
    source,
    setSource,
    requestNumber,
    handleRequestNumberChange,
    assignedTo,
    setAssignedTo,
    isLoading,
  } = form;

  return (
    <>
      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Weitere Angaben</p>

      <Field label="Details" htmlFor="request-details">
        <Textarea
          placeholder="Weitere Angaben aus dem Gespräch…"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          disabled={isLoading}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Eingang über" htmlFor="request-source">
          <Select
            value={source}
            onValueChange={(value) => setSource(value as RequestSource)}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REQUEST_SOURCE_ORDER.map((value) => (
                <SelectItem key={value} value={value}>
                  {REQUEST_SOURCE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Anfragenummer" htmlFor="request-number">
          <Input
            placeholder="ANF-2026-001"
            value={requestNumber}
            onChange={(event) => handleRequestNumberChange(event.target.value)}
            disabled={isLoading}
          />
        </Field>
      </div>

      <Field label="Zuständig" htmlFor="request-assignee">
        <SearchableSelect
          options={assignees.map((assignee) => ({
            value: assignee.userId,
            label: assignee.name,
          }))}
          value={assignedTo}
          onChange={setAssignedTo}
          placeholder="Niemand zuständig"
          searchPlaceholder="Mitarbeiter suchen…"
          emptyMessage="Kein Mitarbeiter gefunden"
          allowNone
          noneLabel="Niemand zuständig"
          disabled={isLoading}
        />
      </Field>
    </>
  );
}
