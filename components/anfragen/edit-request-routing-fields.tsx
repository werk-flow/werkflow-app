'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REQUEST_SOURCE_LABELS, REQUEST_SOURCE_ORDER, type RequestSource } from '@/lib/requests/types';
import type { EditRequestForm } from './use-edit-request-form';

interface EditRequestRoutingFieldsProps {
  assignees: Array<{ userId: string; name: string }>;
  form: EditRequestForm;
}

/** Where the request came in, its number and who is responsible. */
export function EditRequestRoutingFields({ assignees, form }: EditRequestRoutingFieldsProps) {
  const { source, setSource, requestNumber, setRequestNumber, assignedTo, setAssignedTo, isLoading } = form;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Eingang über" htmlFor="edit-request-source">
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
        <Field label="Anfragenummer" htmlFor="edit-request-number">
          <Input
            value={requestNumber}
            onChange={(e) => setRequestNumber(e.target.value)}
            disabled={isLoading}
          />
        </Field>
      </div>

      <Field label="Zuständig" htmlFor="edit-request-assignee">
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
