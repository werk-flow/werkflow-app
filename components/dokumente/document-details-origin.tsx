'use client';

import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  DOCUMENT_SOURCE_REFERENCE_MAX_LENGTH,
  DOCUMENT_SOURCE_SYSTEM_MAX_LENGTH,
  type DocumentOrigin,
  type OrganizationDocument,
} from '@/lib/documents/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

/** Resolves whether the origin was saved; a refusal has put the stored origin back. */
export type UpdateDocumentOrigin = (
  document: OrganizationDocument,
  origin: DocumentOrigin,
) => Promise<boolean>;

const UNSAVED_ORIGIN_MESSAGE =
  'Speichere die Herkunft oder setz sie zurück, bevor du die Datei festschreibst.';

/**
 * The typed origin. It stays a draft over the stored origin until
 * „Speichern“, so a refused save keeps it for a retry; it gives way to the
 * stored origin once saved. Filing refuses while the draft differs, since it
 * would file the stored origin, not the shown one.
 */
export function useDocumentOriginDraft(document: OrganizationDocument, onUpdateOrigin: UpdateDocumentOrigin) {
  const controlId = useId();
  const { origin } = document;
  const [systemDraft, setSystemDraft] = useState<string | null>(null);
  const [referenceDraft, setReferenceDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceSystem = systemDraft ?? origin.sourceSystem ?? '';
  const sourceReference = referenceDraft ?? origin.sourceReference ?? '';
  const unsaved =
    sourceSystem.trim() !== (origin.sourceSystem ?? '') ||
    sourceReference.trim() !== (origin.sourceReference ?? '');
  const reset = () => {
    setSystemDraft(null);
    setReferenceDraft(null);
    setError(null);
  };
  return {
    controlId,
    sourceSystem,
    sourceReference,
    error,
    unsaved,
    reset,
    typeSystem: (value: string) => {
      setSystemDraft(value);
      setError(null);
    },
    typeReference: (value: string) => {
      setReferenceDraft(value);
      setError(null);
    },
    save: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!unsaved) return;
      const typed = {
        sourceSystem: sourceSystem.trim() || null,
        sourceReference: sourceReference.trim() || null,
      };
      void onUpdateOrigin(document, typed).then((saved) => {
        if (saved) reset();
      });
    },
    /** Marks and focuses the old number while the origin differs from the stored one; true refuses filing. */
    refuseFiling: () => {
      const message = unsaved ? UNSAVED_ORIGIN_MESSAGE : undefined;
      setError(message ?? null);
      return focusFirstInvalidField({ [controlId]: message });
    },
  };
}

type DocumentOriginDraft = ReturnType<typeof useDocumentOriginDraft>;

function DocumentOriginValues({ origin }: { origin: DocumentOrigin }) {
  if (!origin.sourceSystem && !origin.sourceReference) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Herkunft</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Quellsystem</p>
          <p className="mt-1 wrap-anywhere">{origin.sourceSystem ?? 'Keine Angabe'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Alte Nummer</p>
          <p className="mt-1 wrap-anywhere">{origin.sourceReference ?? 'Keine Angabe'}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * „Herkunft“ in the details: the source system and the old number of a legacy
 * original, which the library search also finds. Admin and Büro change both
 * until the document is filed; otherwise a stored origin shows read-only.
 */
export function DocumentDetailsOrigin({
  origin,
  editable,
  disabled,
  draft,
}: {
  origin: DocumentOrigin;
  editable: boolean;
  disabled: boolean;
  draft: DocumentOriginDraft;
}) {
  if (!editable) return <DocumentOriginValues origin={origin} />;
  return (
    <form onSubmit={draft.save}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Herkunft</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Field label="Quellsystem">
          <Input
            value={draft.sourceSystem}
            onChange={(event) => draft.typeSystem(event.target.value)}
            maxLength={DOCUMENT_SOURCE_SYSTEM_MAX_LENGTH}
            placeholder="z. B. Sykasoft"
            disabled={disabled}
          />
        </Field>
        <Field label="Alte Nummer" htmlFor={draft.controlId} error={draft.error}>
          <Input
            value={draft.sourceReference}
            onChange={(event) => draft.typeReference(event.target.value)}
            maxLength={DOCUMENT_SOURCE_REFERENCE_MAX_LENGTH}
            placeholder="z. B. RE-2019-0042"
            disabled={disabled}
          />
        </Field>
      </div>
      <p className="mt-2 text-muted-foreground">
        {draft.unsaved
          ? 'Die Suche findet die Datei unter ihrer alten Nummer, sobald du sie speicherst.'
          : 'Die Suche findet die Datei auch unter ihrer alten Nummer.'}
      </p>
      {draft.unsaved && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            aria-label="Herkunft speichern"
            pending={disabled}
          >
            Speichern
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Herkunft zurücksetzen"
            onClick={draft.reset}
            disabled={disabled}
          >
            Zurücksetzen
          </Button>
        </div>
      )}
    </form>
  );
}
