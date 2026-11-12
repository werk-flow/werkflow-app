'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { FileInput } from '@/components/ui/file-input';
import { InlinePending } from '@/components/ui/inline-pending';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import { removeCompanyDocumentFile } from '@/lib/company-profile/actions';
import {
  COMPANY_FILE_RULES,
  type CompanyFileKind,
  type StoredCompanyFile,
} from '@/lib/company-profile/profile';
import { uploadCompanyFile } from '@/lib/company-profile/upload-client';

const FILE_FAILURES = {
  not_authorized: 'Nur Admins und das Büro können Logo und Briefpapier ändern.',
  file_type_not_allowed: 'Diese Datei passt nicht. Erlaubt sind die genannten Dateitypen.',
  file_too_large: 'Die Datei ist zu groß.',
  file_empty: 'Die Datei ist leer.',
  file_unreadable:
    'Die Datei lässt sich nicht lesen. Speichere sie neu als PNG, JPG oder PDF und lade sie noch einmal hoch.',
  file_missing: 'Die Datei ist nicht vollständig angekommen. Lade sie noch einmal hoch.',
  stationery_first_missing: 'Lade zuerst das Briefpapier für die erste Seite hoch.',
} satisfies Record<string, string>;

type FileRow = { kind: CompanyFileKind; label: string; description: string; types: string };

const FILE_ROWS: readonly FileRow[] = [
  {
    kind: 'logo',
    label: 'Logo',
    description: 'Steht oben rechts im Briefkopf, wenn kein Briefpapier hinterlegt ist.',
    types: 'PNG oder JPG, höchstens 2 MB',
  },
  {
    kind: 'stationery_first',
    label: 'Briefpapier erste Seite',
    description: 'Liegt unter der ersten Seite jedes Angebots.',
    types: 'PDF, PNG oder JPG im Format A4, höchstens 5 MB',
  },
  {
    kind: 'stationery_following',
    label: 'Briefpapier Folgeseiten',
    description: 'Liegt unter jeder weiteren Seite. Ohne bleiben die Folgeseiten weiß.',
    types: 'PDF, PNG oder JPG im Format A4, höchstens 5 MB',
  },
];

const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
};

function LetterheadFileRow({
  row,
  organizationId,
  stored,
  blockedBy,
}: {
  row: FileRow;
  organizationId: string;
  stored: StoredCompanyFile | null;
  /** Why the row cannot take a file yet, or null. */
  blockedBy: string | null;
}) {
  const { showBanner } = useBanner();
  const { run, isPending } = usePendingTask();
  const [failure, setFailure] = useState<string | null>(null);

  const perform = (task: () => Promise<ActionResult>, success: string, fallback: string) =>
    run(async () => {
      setFailure(null);
      const result = await task();
      if (result.success) showBanner({ variant: 'success', message: success });
      else setFailure(describeFailure(result.error, FILE_FAILURES, fallback));
    });

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {row.label}
          <InlinePending active={isPending} label={`${row.label} wird gespeichert`} />
        </p>
        <p className="text-sm text-muted-foreground">{row.description}</p>
        <p className="text-sm text-muted-foreground">
          {stored ? `Hinterlegt (${TYPE_LABELS[stored.mimeType] ?? 'Datei'})` : 'Noch nicht hinterlegt'} ·{' '}
          {row.types}
        </p>
        {blockedBy && <p className="text-sm text-muted-foreground">{blockedBy}</p>}
        <ErrorText>{failure}</ErrorText>
      </div>
      {!blockedBy && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={`${row.label} auswählen`} hideLabel>
            <FileInput
              buttonLabel={stored ? 'Ersetzen' : 'Hochladen'}
              fileName={null}
              accept={COMPANY_FILE_RULES[row.kind].mimeTypes.join(',')}
              disabled={isPending}
              onSelect={(file) => {
                if (!file) return;
                void perform(
                  () => uploadCompanyFile(organizationId, row.kind, file),
                  `${row.label} wurde gespeichert.`,
                  `${row.label} konnte nicht gespeichert werden. Versuch es noch einmal.`,
                );
              }}
            />
          </Field>
          {stored && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                void perform(
                  () => removeCompanyDocumentFile({ organizationId, kind: row.kind }),
                  `${row.label} wurde entfernt.`,
                  `${row.label} konnte nicht entfernt werden. Versuch es noch einmal.`,
                )
              }
            >
              Entfernen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Logo and stationery: each uploads straight to storage and replaces the stored file. */
export function DocumentLetterheadFiles({
  organizationId,
  files,
}: {
  organizationId: string;
  files: Record<CompanyFileKind, StoredCompanyFile | null>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo und Briefpapier</CardTitle>
        <CardDescription>
          Mit Briefpapier druckt WerkFlow keinen eigenen Briefkopf und keinen Fuß, denn beides steht auf
          deinem Briefpapier.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {FILE_ROWS.map((row) => (
          <LetterheadFileRow
            key={row.kind}
            row={row}
            organizationId={organizationId}
            stored={files[row.kind]}
            blockedBy={
              row.kind === 'stationery_following' && !files.stationery_first
                ? 'Lade zuerst das Briefpapier für die erste Seite hoch.'
                : null
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}
