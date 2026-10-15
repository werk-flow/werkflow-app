'use client';

import { type ReactElement } from 'react';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { WorkTemplateTargetType } from '@/lib/work-templates/types';

export function WorkTemplatePicker({
  targetType,
  value,
  onChange,
  disabled,
}: {
  targetType: WorkTemplateTargetType;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): ReactElement {
  const templates = useClientRead({
    read: (signal) => readInBackground('published-work-templates', { targetType }, signal),
    deps: [targetType],
    failureMessage: 'Arbeitsvorlagen konnten nicht geladen werden.',
  });
  const options = templates.data?.data;
  return (
    <Field
      label="Arbeitsvorlage (optional)"
      htmlFor={`work-template-${targetType}`}
      description={
        templates.failure ? undefined : options?.length === 0 ? (
          <>
            Noch keine passende Vorlage veröffentlicht.{' '}
            <TextLink href="/arbeitsvorlagen">Arbeitsvorlagen verwalten</TextLink>
          </>
        ) : (
          'Die Inhalte werden als bearbeitbare Planung übernommen. Bestand und Kalender bleiben unverändert.'
        )
      }
    >
      {templates.failure ? (
        <SectionError failure={templates.failure} />
      ) : options === undefined ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <SearchableSelect
          options={options.map((option) => ({
            value: option.versionId,
            label: option.name,
            description: `Version ${option.versionNumber}${option.description ? ` · ${option.description}` : ''}`,
          }))}
          value={value}
          onChange={onChange}
          allowNone
          noneLabel="Ohne Arbeitsvorlage"
          placeholder="Arbeitsvorlage wählen"
          searchPlaceholder="Arbeitsvorlagen suchen…"
          emptyMessage="Keine veröffentlichte Arbeitsvorlage"
          disabled={disabled}
        />
      )}
    </Field>
  );
}
