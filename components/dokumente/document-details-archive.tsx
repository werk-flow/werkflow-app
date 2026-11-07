'use client';

import { Lock } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DOCUMENT_RETENTION_CLASS_LABELS,
  DOCUMENT_RETENTION_CLASSES,
  type DocumentArchive,
  type DocumentRetentionTerms,
  type OrganizationDocument,
} from '@/lib/documents/types';
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
  onChange: (terms: DocumentRetentionTerms) => void;
};

/**
 * The picker reports every typed segment, a lone day digit or a paused year
 * included, so the date stays a draft until „Speichern“: only a date the user
 * confirms reaches the audited write.
 */
function DocumentDateField({ archive, editable, disabled, onChange }: RetentionFieldProps) {
  const [draft, setDraft] = useState(() => parseIsoLocalDate(archive.documentDate));
  const draftDate = draft ? toLocalDateString(draft) : archive.documentDate;
  return (
    <div>
      <p className="text-xs text-muted-foreground">Belegdatum</p>
      <div className="mt-1">
        {editable ? (
          <div className="flex items-center gap-2">
            <DatePicker
              value={draft}
              onChange={(date) => {
                if (date) setDraft(date);
              }}
              disabled={disabled}
              ariaLabel="Belegdatum der Datei"
            />
            {draftDate !== archive.documentDate && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Belegdatum speichern"
                onClick={() => onChange({ documentDate: draftDate, retentionClass: archive.retentionClass })}
                disabled={disabled}
              >
                Speichern
              </Button>
            )}
          </div>
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
              onChange({ documentDate: archive.documentDate, retentionClass: retentionClass ?? null });
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
  onUpdateRetention: (document: OrganizationDocument, terms: DocumentRetentionTerms) => void;
  onFile: (document: OrganizationDocument) => void;
};

/**
 * „Aufbewahrung" in the details: document date, retention class and end, and
 * the filed state. Admin and Büro change date and class until they file the
 * document; an employee receives no archive data, so nothing renders.
 */
export function DocumentDetailsArchive({
  document,
  disabled,
  isTrashView,
  onUpdateRetention,
  onFile,
}: DocumentDetailsArchiveProps) {
  const { archive } = document;
  if (!archive) return null;
  const editable = !archive.filedAt && !isTrashView;
  const fieldProps: RetentionFieldProps = {
    archive,
    editable,
    disabled,
    onChange: (terms) => onUpdateRetention(document, terms),
  };
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
              onClick={() => onFile(document)}
              disabled={disabled}
            >
              <Lock className="size-4" />
              Festschreiben
            </Button>
          )
        )}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <DocumentDateField key={archive.documentDate} {...fieldProps} />
        <RetentionClassField {...fieldProps} />
      </div>
      <p className="mt-2 text-muted-foreground">{retentionSummary(archive)}</p>
    </div>
  );
}
