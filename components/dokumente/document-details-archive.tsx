'use client';

import { Lock } from 'lucide-react';
import { useId, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DOCUMENT_RETENTION_CLASS_LABELS,
  DOCUMENT_RETENTION_CLASSES,
  type DocumentArchive,
  type DocumentRetentionTerms,
  type OrganizationDocument,
} from '@/lib/documents/types';
import { documentDateRange, isDocumentDateInRange } from '@/lib/documents/retention';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate as formatDate, parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import { getUserDisplayName } from './document-library-file-labels';

const NO_RETENTION_CLASS = 'none';

function retentionSummary(archive: DocumentArchive): string {
  const endsOn = archive.retentionEndsOn ? formatDate(archive.retentionEndsOn) : null;
  if (archive.filedAt) {
    const filed = `Festgeschrieben am ${formatDate(archive.filedAt)} von ${getUserDisplayName(archive.filer)}.`;
    return endsOn
      ? `${filed} Die Datei bleibt bis ${endsOn} unverändert und lässt sich nicht löschen.`
      : `${filed} Die Datei bleibt unverändert und lässt sich nicht löschen.`;
  }
  return endsOn
    ? `Aufbewahren bis ${endsOn}. Bis dahin lässt sich die Datei nicht endgültig löschen.`
    : 'Ohne Aufbewahrungsfrist.';
}

type RetentionFieldProps = {
  archive: DocumentArchive;
  editable: boolean;
  disabled: boolean;
  /** Resolves whether the change was saved; a refusal has put the stored terms back. */
  onChange: (terms: DocumentRetentionTerms) => Promise<boolean>;
};

const UNSAVED_DATE_MESSAGE =
  'Speichere das Belegdatum oder setz es zurück, bevor du die Datei festschreibst.';

/**
 * The typed document date. The picker reports every typed segment, a lone day
 * digit or a paused year included, so the date stays a draft until
 * „Speichern“: only a date the user confirms reaches the audited write, and
 * only inside the document date range (a paused „20“ is the year 20). The
 * draft outlives a refused save, so the user can retry it, and gives way to
 * the stored date once saved. Filing refuses while a draft differs, since it
 * would file the stored date, not the shown one.
 */
function useDocumentDateDraft(archive: DocumentArchive, onChange: RetentionFieldProps['onChange']) {
  const controlId = useId();
  const [draft, setDraft] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftDate = draft ? toLocalDateString(draft) : archive.documentDate;
  const unsaved = draftDate !== archive.documentDate;
  const markInvalid = (message: string | undefined) => {
    setError(message ?? null);
    return focusFirstInvalidField({ [controlId]: message });
  };
  return {
    controlId,
    draft,
    error,
    unsaved,
    type: (date: Date) => {
      setDraft(date);
      setError(null);
    },
    reset: () => {
      setDraft(null);
      setError(null);
    },
    save: () => {
      const range = documentDateRange();
      const outOfRange = isDocumentDateInRange(draftDate, range)
        ? undefined
        : `Gib ein Belegdatum zwischen dem ${formatDate(range.earliest)} und dem ${formatDate(range.latest)} ein.`;
      if (markInvalid(outOfRange)) return;
      void onChange({ documentDate: draftDate, retentionClass: archive.retentionClass }).then((saved) => {
        if (saved) setDraft(null);
      });
    },
    /** Marks and focuses the date while it differs from the stored one; true refuses filing. */
    refuseFiling: () => markInvalid(unsaved ? UNSAVED_DATE_MESSAGE : undefined),
  };
}

type DocumentDateFieldProps = Omit<RetentionFieldProps, 'onChange'> & {
  date: ReturnType<typeof useDocumentDateDraft>;
};

function DocumentDateField({ archive, editable, disabled, date }: DocumentDateFieldProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">Belegdatum</p>
      <div className="mt-1">
        {editable ? (
          <Field label="Belegdatum" hideLabel htmlFor={date.controlId} error={date.error}>
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker
                value={date.draft ?? parseIsoLocalDate(archive.documentDate)}
                onChange={(next) => {
                  if (next) date.type(next);
                }}
                disabled={disabled}
                ariaLabel="Belegdatum der Datei"
              />
              {date.unsaved && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Belegdatum speichern"
                    onClick={date.save}
                    disabled={disabled}
                  >
                    Speichern
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Belegdatum zurücksetzen"
                    onClick={date.reset}
                    disabled={disabled}
                  >
                    Zurücksetzen
                  </Button>
                </>
              )}
            </div>
          </Field>
        ) : (
          <p>{formatDate(archive.documentDate)}</p>
        )}
      </div>
    </div>
  );
}

function RetentionClassField({ archive, editable, disabled, onChange }: RetentionFieldProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">Aufbewahrungsfrist</p>
      <div className="mt-1">
        {editable ? (
          <Select
            value={archive.retentionClass ?? NO_RETENTION_CLASS}
            onValueChange={(value) => {
              const retentionClass = DOCUMENT_RETENTION_CLASSES.find((candidate) => candidate === value);
              void onChange({ documentDate: archive.documentDate, retentionClass: retentionClass ?? null });
            }}
            disabled={disabled}
          >
            <SelectTrigger className="w-full" aria-label="Aufbewahrungsfrist der Datei">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RETENTION_CLASS}>Ohne Frist</SelectItem>
              {Object.entries(DOCUMENT_RETENTION_CLASS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p>
            {archive.retentionClass ? DOCUMENT_RETENTION_CLASS_LABELS[archive.retentionClass] : 'Ohne Frist'}
          </p>
        )}
      </div>
    </div>
  );
}

export type DocumentDetailsArchiveProps = {
  document: OrganizationDocument;
  disabled: boolean;
  isTrashView: boolean;
  onUpdateRetention: (document: OrganizationDocument, terms: DocumentRetentionTerms) => Promise<boolean>;
  onFile: (document: OrganizationDocument) => void;
};

/**
 * „Aufbewahrung" in the details: document date, retention class and end, and
 * the filed state. Admin and Büro change date and class until they file the
 * document; an employee receives no archive data, so nothing renders.
 */
export function DocumentDetailsArchive(props: DocumentDetailsArchiveProps) {
  const { archive } = props.document;
  if (!archive) return null;
  return <DocumentArchiveSection key={props.document.id} archive={archive} {...props} />;
}

function DocumentArchiveSection({
  archive,
  document,
  disabled,
  isTrashView,
  onUpdateRetention,
  onFile,
}: DocumentDetailsArchiveProps & { archive: DocumentArchive }) {
  const editable = !archive.filedAt && !isTrashView;
  const onChange = (terms: DocumentRetentionTerms) => onUpdateRetention(document, terms);
  const date = useDocumentDateDraft(archive, onChange);
  const fieldProps: RetentionFieldProps = { archive, editable, disabled, onChange };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aufbewahrung</p>
        {archive.filedAt ? (
          <Badge variant="outline">
            <Lock />
            Festgeschrieben
          </Badge>
        ) : (
          editable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (!date.refuseFiling()) onFile(document);
              }}
              disabled={disabled}
            >
              <Lock className="size-4" />
              Festschreiben
            </Button>
          )
        )}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <DocumentDateField archive={archive} editable={editable} disabled={disabled} date={date} />
        <RetentionClassField {...fieldProps} />
      </div>
      <p className="mt-2 text-muted-foreground">{retentionSummary(archive)}</p>
    </div>
  );
}
