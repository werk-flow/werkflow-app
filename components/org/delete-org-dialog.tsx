'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { loadDocument } from '@/lib/navigation/document-load';
import { deleteOrganization, type DeleteOrgResult } from '@/lib/org/delete-action';
import type { OrganizationDeletionScope } from '@/lib/org/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { cn } from '@/lib/utils';

const CONFIRM_NAME_ID = 'confirm-name';
const NAME_MISMATCH = 'Der eingegebene Name stimmt nicht überein.';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  org_not_found: 'Organisation nicht gefunden.',
  not_authorized: 'Nur der Admin kann die Organisation löschen.',
  name_mismatch: NAME_MISMATCH,
  has_time_records:
    'Die Organisation enthält inzwischen erfasste Arbeitszeiten oder abgeschlossene Perioden und kann deshalb nicht gelöscht werden.',
  files_delete_failed:
    'Die gespeicherten Dateien konnten nicht gelöscht werden. Die Organisation bleibt bestehen. Versuche es in einem Moment erneut.',
  delete_org_failed: 'Fehler beim Löschen der Organisation.',
};

interface DeleteOrgDialogProps {
  orgName: string;
  /** Null for a caller who may not delete: the trigger stays disabled. */
  scope: OrganizationDeletionScope | null;
}

function ScopeList({ rows }: { rows: readonly (readonly [string, number])[] }) {
  return (
    <dl className="mt-2 divide-y rounded-md border">
      {rows.map(([label, count]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
          <dt>{label}</dt>
          <dd className="font-medium text-foreground tabular-nums">{count}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Why the organization stays and what it holds. */
function RetainedDescription({ scope }: { scope: OrganizationDeletionScope }) {
  return (
    <AlertDialogDescription asChild>
      <div className="space-y-3 text-left text-muted-foreground text-sm">
        <p>
          <span className="font-semibold text-foreground">
            Diese Organisation kann nicht gelöscht werden,
          </span>{' '}
          weil sie erfasste Arbeitszeiten oder abgeschlossene Perioden enthält:
        </p>
        <ScopeList
          rows={[
            ['Personen mit erfasster Arbeitszeit', scope.timeTrackedPeople],
            ['Abgeschlossene Perioden', scope.closedPeriods],
            ['Lohnexporte', scope.payrollExports],
          ]}
        />
        <p>
          Arbeitszeitaufzeichnungen und Lohnunterlagen musst du gesetzlich aufbewahren, zum Beispiel nach dem
          Arbeitszeitgesetz und dem Mindestlohngesetz. Mit der Organisation wären sie unwiderruflich weg.
        </p>
        <p>
          Unter Perioden schließt du offene Monate ab und lädst für jede abgeschlossene Periode den Lohnexport
          herunter.
        </p>
      </div>
    </AlertDialogDescription>
  );
}

/** The irreversible consequence and everything the deletion removes, with counts. */
function DeletionScopeDescription({ scope }: { scope: OrganizationDeletionScope }) {
  return (
    <AlertDialogDescription asChild>
      <div className="text-left text-muted-foreground text-sm">
        <span className="font-semibold text-foreground">
          Diese Aktion kann nicht rückgängig gemacht werden.
        </span>{' '}
        Die Organisation wird dauerhaft gelöscht, zusammen mit allen Daten und gespeicherten Dateien:
        <ScopeList
          rows={[
            ['Mitgliedschaften', scope.members],
            ['Offene Einladungen', scope.openInvites],
            ['Kunden', scope.clients],
            ['Projekte', scope.projects],
            ['Aufträge', scope.jobs],
            ['Personalakten', scope.employeeRecords],
            ['Dokumente, Fotos und Personalunterlagen', scope.documents],
          ]}
        />
        <p className="mt-3">
          Mitglieder, die nur dieser Organisation angehören, werden zur Onboarding-Seite weitergeleitet.
        </p>
      </div>
    </AlertDialogDescription>
  );
}

/**
 * The typed name and the delete of a deletion the server allows. The content
 * unmounts on close, so a reopened dialog starts empty.
 */
function DeletionConfirmation({
  orgName,
  onDelete,
  onDeleted,
  isLoading,
}: {
  orgName: string;
  onDelete: (confirmationName: string) => Promise<DeleteOrgResult>;
  onDeleted: () => void;
  isLoading: boolean;
}) {
  const [confirmationName, setConfirmationName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useRouterRefresh();

  const handleDelete = async () => {
    setError(null);
    if (confirmationName.trim() !== orgName) {
      setNameError(NAME_MISMATCH);
      focusFirstInvalidField({ [CONFIRM_NAME_ID]: NAME_MISMATCH });
      return;
    }
    setNameError(null);

    try {
      const result = await onDelete(confirmationName);
      if (result.success) {
        onDeleted();
        // A full load so the next page reads the changed active-organization
        // cookie; without a remaining organization the user starts onboarding.
        loadDocument(result.nextOrgId ? '/dashboard?org_deleted=true' : '/onboarding/start?org_deleted=true');
        return;
      }
      setError(describeFailure(result.error, ERROR_MESSAGES, SHARED_FAILURE_MESSAGES.unexpected_error));
      // Time recorded since the page loaded: the re-read scope turns the
      // dialog into the refusal with its retention reason and the export.
      if (result.error === 'has_time_records') refresh();
    } catch {
      setError(SHARED_FAILURE_MESSAGES.unexpected_error);
    }
  };

  return (
    <>
      <div className="space-y-3 py-2">
        <Field
          label="Gib den Namen der Organisation ein, um zu bestätigen:"
          htmlFor={CONFIRM_NAME_ID}
          required
          error={nameError}
        >
          <div className="rounded-md bg-muted px-3 py-2 text-sm font-medium">{orgName}</div>
          <Input
            id={CONFIRM_NAME_ID}
            value={confirmationName}
            onChange={(e) => setConfirmationName(e.target.value)}
            placeholder="Organisationsname eingeben"
            disabled={isLoading}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
        <AlertDialogAction
          // Keep the dialog open until the server confirms; a failure must
          // stay visible at the point of action.
          onClick={(event) => {
            event.preventDefault();
            void handleDelete();
          }}
          pending={isLoading}
          variant="destructive"
        >
          {isLoading ? 'Wird gelöscht…' : 'Endgültig löschen'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

/**
 * An organization with time records offers its periods instead of the
 * deletion; otherwise the dialog lists what goes and asks for the name.
 */
export function DeleteOrgDialog({ orgName, scope }: DeleteOrgDialogProps) {
  const [open, setOpen] = useState(false);
  const { run: runDelete, isPending: isLoading } = useServerAction(deleteOrganization);
  const retained = scope?.retainsTimeRecords ?? false;

  return (
    <AlertDialog open={open} onOpenChange={setOpen} pending={isLoading}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="w-full" disabled={!scope}>
          <Trash2 className="size-4" />
          Organisation löschen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className={cn('flex items-center gap-2', !retained && 'text-destructive')}>
            <AlertTriangle className="size-5" />
            Organisation löschen
          </AlertDialogTitle>
          {scope && retained ? <RetainedDescription scope={scope} /> : null}
          {scope && !retained ? <DeletionScopeDescription scope={scope} /> : null}
        </AlertDialogHeader>
        {retained ? (
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Link href="/zeiterfassung/perioden">Zu den Perioden</Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        ) : (
          <DeletionConfirmation
            orgName={orgName}
            onDelete={runDelete}
            onDeleted={() => setOpen(false)}
            isLoading={isLoading}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
