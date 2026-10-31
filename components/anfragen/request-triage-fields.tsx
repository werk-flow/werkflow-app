'use client';

import { DateTimeField } from '@/components/ui/date-time-field';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CATEGORY_ORDER,
  REQUEST_URGENCY_LABELS,
  REQUEST_URGENCY_ORDER,
} from '@/lib/requests/types';
import type { CreateRequestForm } from './use-create-request-form';

interface RequestTriageFieldsProps {
  /** `request` in the create dialog, `edit-request` in the edit dialog. */
  idPrefix: 'request' | 'edit-request';
  form: Pick<
    CreateRequestForm,
    | 'category'
    | 'setCategory'
    | 'urgency'
    | 'setUrgency'
    | 'receivedAt'
    | 'setReceivedAt'
    | 'receivedAtError'
    | 'isLoading'
  >;
}

/** Category, urgency and received-at time of the create and edit dialogs. */
export function RequestTriageFields({ idPrefix, form }: RequestTriageFieldsProps) {
  const {
    category,
    setCategory,
    urgency,
    setUrgency,
    receivedAt,
    setReceivedAt,
    receivedAtError,
    isLoading,
  } = form;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kategorie" htmlFor={`${idPrefix}-category`}>
          <Select
            value={category}
            onValueChange={(value) => {
              const nextCategory = REQUEST_CATEGORY_ORDER.find((candidate) => candidate === value);
              if (nextCategory) setCategory(nextCategory);
            }}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REQUEST_CATEGORY_ORDER.map((value) => (
                <SelectItem key={value} value={value}>
                  {REQUEST_CATEGORY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Dringlichkeit" htmlFor={`${idPrefix}-urgency`}>
          <Select
            value={urgency}
            onValueChange={(value) => {
              const nextUrgency = REQUEST_URGENCY_ORDER.find((candidate) => candidate === value);
              if (nextUrgency) setUrgency(nextUrgency);
            }}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REQUEST_URGENCY_ORDER.map((value) => (
                <SelectItem key={value} value={value}>
                  {REQUEST_URGENCY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Eingangszeit" htmlFor={`${idPrefix}-received-at-date`} error={receivedAtError}>
        <DateTimeField
          idPrefix={`${idPrefix}-received-at`}
          value={receivedAt}
          onChange={setReceivedAt}
          disabled={isLoading}
          dateAriaLabel="Eingangsdatum"
          invalid={receivedAtError !== null}
          describedById={receivedAtError ? `${idPrefix}-received-at-date-error` : undefined}
        />
      </Field>
    </>
  );
}
