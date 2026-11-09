'use client';

import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useClientOption } from '@/components/service/use-client-option';
import { requestEquipmentOptions } from '@/lib/requests/types';

interface RequestEquipmentFieldProps {
  /** `request` in the create dialog, `edit-request` in the edit dialog. */
  idPrefix: 'request' | 'edit-request';
  clientId: string;
  siteId: string;
  value: string;
  onChange: (equipmentId: string) => void;
  disabled: boolean;
}

/**
 * The active Anlagen of the chosen site, read once a site is chosen, and a
 * saved Anlage that is no longer active, so it can be cleared. Nothing without
 * a site; an empty list says that nothing is recorded there.
 */
export function RequestEquipmentField({
  idPrefix,
  clientId,
  siteId,
  value,
  onChange,
  disabled,
}: RequestEquipmentFieldProps) {
  const { client, loading, loadFailure } = useClientOption(siteId ? clientId : '');
  if (!clientId || !siteId) return null;
  // Only a settled read says that a saved Anlage is no longer active; until
  // then, or after a failed read, it keeps a neutral label.
  const settled = !loading && !loadFailure;
  const options = settled
    ? requestEquipmentOptions(client?.sites.find((site) => site.id === siteId)?.equipment ?? [], value)
    : value
      ? [{ value, label: 'Gespeicherte Anlage' }]
      : [];

  if (settled && options.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">Anlage</p>
        <p className="text-sm text-muted-foreground">An diesem Einsatzort ist keine Anlage erfasst.</p>
      </div>
    );
  }

  return (
    <Field label="Anlage" htmlFor={`${idPrefix}-equipment`}>
      <SearchableSelect
        options={options}
        value={value}
        onChange={onChange}
        loading={loading}
        loadFailure={loadFailure}
        placeholder="Keine Anlage"
        searchPlaceholder="Anlage suchen…"
        emptyMessage="Keine Anlage gefunden"
        allowNone
        noneLabel="Keine Anlage"
        disabled={disabled}
      />
    </Field>
  );
}
