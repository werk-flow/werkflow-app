'use client';

import { useEffect, useRef, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  organization_changed: 'Inzwischen ist eine andere Organisation aktiv. Lade die Seite neu.',
  file_type_not_allowed: 'Diese Datei passt nicht. Erlaubt sind die genannten Dateitypen.',
  file_too_large: 'Die Datei ist zu groß.',
  file_empty: 'Die Datei ist leer.',
  file_unreadable:
    'Die Datei lässt sich nicht lesen. Speichere sie neu als PNG, JPG oder PDF und lade sie noch einmal hoch.',
  file_missing: 'Die Datei ist nicht vollständig angekommen. Lade sie noch einmal hoch.',
  stationery_first_missing: 'Lade zuerst das Briefpapier für die erste Seite hoch.',
  file_changed: 'Jemand hat die Datei inzwischen geändert. Lade die Seite neu und prüf sie noch einmal.',
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

/**
 * A row's upload or removal and what it shows: a banner when it succeeds, the
 * reason on the row when it fails. The row of another organization unmounts
 * on a switch, so a late result of that row shows nowhere.
 */
function useFileTask() {
  const { showBanner } = useBanner();
  const { run, isPending } = usePendingTask();
  const [failure, setFailure] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const perform = (task: () => Promise<ActionResult>, success: string, fallback: string) =>
    run(async () => {
      setFailure(null);
      // A lost connection rejects the call; it shows like a refused one.
      const result = await task().catch((): ActionResult => ({ success: false, error: 'request_failed' }));
      if (!mounted.current) return;
      if (result.success) showBanner({ variant: 'success', message: success });
      else setFailure(describeFailure(result.error, FILE_FAILURES, fallback));
    });
  return { perform, isPending, failure };
}

/**
 * The attempt key of a removal, bound to the files it removes: pressed again
 * for the same files after a lost answer, it is the same attempt and gets the
 * first result; other files, such as a new upload in their place, are a new
 * attempt that never takes the earlier removal's success for its own.
 */
function useRemovalKey(): (files: readonly (string | null)[]) => string {
  const last = useRef<{ key: string; files: string } | null>(null);
  return (files) => {
    const target = JSON.stringify(files);
    const attempt =
      last.current?.files === target ? last.current : { key: crypto.randomUUID(), files: target };
    last.current = attempt;
    return attempt.key;
  };
}

function LetterheadFileRow({
  row,
  organizationId,
  stored,
  alsoRemoves,
  blockedBy,
}: {
  row: FileRow;
  organizationId: string;
  stored: StoredCompanyFile | null;
  /** The following pages' file a removal of this row removes too, or null. */
  alsoRemoves: StoredCompanyFile | null;
  /** Why the row cannot take a file yet, or null. */
  blockedBy: string | null;
}) {
  const { perform, isPending, failure } = useFileTask();
  const removalKey = useRemovalKey();

  const status = stored ? `Hinterlegt (${TYPE_LABELS[stored.mimeType] ?? 'Datei'})` : 'Noch nicht hinterlegt';
  const label = (
    <span className="flex items-center gap-2">
      {row.label}
      <InlinePending active={isPending} label={`${row.label} wird gespeichert`} />
    </span>
  );
  const description = (
    <>
      {row.description} {status} · {row.types}
      {blockedBy && <span className="block">{blockedBy}</span>}
    </>
  );
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <Field label={label} description={description} error={failure ?? undefined}>
        {blockedBy ? null : (
          <div className="flex flex-wrap gap-2">
            <FileInput
              buttonLabel={stored ? 'Ersetzen' : 'Hochladen'}
              fileName={null}
              accept={COMPANY_FILE_RULES[row.kind].mimeTypes.join(',')}
              disabled={isPending}
              onSelect={(file) => {
                if (!file) return;
                void perform(
                  () => uploadCompanyFile(organizationId, row.kind, file, stored?.storagePath ?? null),
                  `${row.label} wurde gespeichert.`,
                  `${row.label} konnte nicht gespeichert werden. Versuch es noch einmal.`,
                );
              }}
            />
            {stored && (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  void perform(
                    () =>
                      removeCompanyDocumentFile({
                        organizationId,
                        kind: row.kind,
                        expectedStoragePath: stored.storagePath,
                        expectedFollowingStoragePath: alsoRemoves?.storagePath ?? null,
                        attemptKey: removalKey([stored.storagePath, alsoRemoves?.storagePath ?? null]),
                      }),
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
      </Field>
    </div>
  );
}

/**
 * Logo and stationery: each uploads straight to storage and replaces the
 * stored file the row shows. The rows belong to one organization and start
 * anew for another.
 */
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
            key={`${organizationId}:${row.kind}`}
            row={row}
            organizationId={organizationId}
            stored={files[row.kind]}
            alsoRemoves={row.kind === 'stationery_first' ? files.stationery_following : null}
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
