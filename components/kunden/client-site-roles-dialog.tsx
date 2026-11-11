'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  ClientSelectWithCreate,
  type ClientSelectItem,
} from '@/components/auftraege/shared/client-select-with-create';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { TextLink } from '@/components/ui/text-link';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange, type SettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { assignClientSiteRole, endClientSiteRole } from '@/lib/clients/site-role-actions';
import {
  SITE_ROLE_KINDS,
  SITE_ROLE_LABELS,
  berlinToday,
  describeSiteRolePeriod,
  siteRoleState,
  type ClientSiteRole,
  type SiteRoleKind,
} from '@/lib/clients/site-roles';
import { formatSiteAddress, type ClientSite } from '@/lib/clients/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate, toLocalDateString } from '@/lib/utils';

const ERROR_MESSAGES: Record<string, string> = {
  site_not_found: 'Der Einsatzort wurde nicht gefunden.',
  holder_not_found: 'Der Kunde wurde nicht gefunden.',
  holder_archived: 'Der Kunde ist archiviert. Stelle ihn zuerst wieder her.',
  holder_unchanged: 'Dieser Kunde hat die Rolle bereits.',
  role_starts_before_current: 'Der Wechsel muss nach dem Beginn der bisherigen Rolle liegen.',
  role_overlaps: 'In diesem Zeitraum hat schon ein anderer Kunde diese Rolle.',
  role_not_found: 'Die Rolle wurde nicht gefunden.',
  role_already_ended: 'Die Rolle ist bereits beendet.',
  role_ends_before_start: 'Das Ende darf nicht vor dem Beginn liegen.',
};

/** What the dialog edits: a new or changed holder of a kind, or the end of a role. */
type RoleEdit =
  | { mode: 'assign'; kind: SiteRoleKind; replace: boolean }
  | { mode: 'end'; kind: SiteRoleKind; role: ClientSiteRole };

const HOLDER_FIELD_ID = 'site-role-holder';
const DATE_FIELD_ID = 'site-role-date';

function toDate(value: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

/** The roles of one kind: current and coming holders, then the earlier ones. */
function SiteRoleKindSection({
  kind,
  roles,
  clientId,
  today,
  onEdit,
}: {
  kind: SiteRoleKind;
  roles: ClientSiteRole[];
  clientId: string;
  today: string;
  onEdit: (edit: RoleEdit) => void;
}) {
  const ofKind = roles.filter((role) => role.role === kind);
  const open = ofKind.filter((role) => siteRoleState(role, today) !== 'ended');
  const ended = ofKind.filter((role) => siteRoleState(role, today) === 'ended');
  const lasting = open.find((role) => role.endsOn === null);
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label={SITE_ROLE_LABELS[kind]}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{SITE_ROLE_LABELS[kind]}</p>
        <div className="flex gap-1">
          {lasting ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEdit({ mode: 'assign', kind, replace: true })}
              >
                Wechseln
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEdit({ mode: 'end', kind, role: lasting })}
              >
                Beenden
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEdit({ mode: 'assign', kind, replace: false })}
            >
              Eintragen
            </Button>
          )}
        </div>
      </div>
      {open.length === 0 && <p className="text-sm text-muted-foreground">Nicht eingetragen</p>}
      <ul className="space-y-1 text-sm">
        {open.map((role) => (
          <SiteRoleLine key={role.id} role={role} clientId={clientId} today={today} />
        ))}
      </ul>
      {ended.length > 0 && (
        <div className="border-t pt-2">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Früher</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {ended.map((role) => (
              <SiteRoleLine key={role.id} role={role} clientId={clientId} today={today} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SiteRoleLine({ role, clientId, today }: { role: ClientSiteRole; clientId: string; today: string }) {
  return (
    <li className="flex flex-wrap gap-x-2">
      {role.holderClientId === clientId ? (
        <span>{role.holderName}</span>
      ) : (
        <TextLink href={`/kunden/${role.holderClientId}`}>{role.holderName}</TextLink>
      )}
      <span className="text-muted-foreground">{describeSiteRolePeriod(role, today, formatGermanDate)}</span>
      {role.holderArchived && <span className="text-muted-foreground">· archiviert</span>}
    </li>
  );
}

type SiteRoleEditProps = {
  site: ClientSite;
  edit: RoleEdit;
  /** Resolves once the refreshed roles arrived, so the list never shows the old state. */
  settle: SettleOnChange;
  /** The dialog's save task: the dialog stays open and its close disabled while a save runs. */
  task: ReturnType<typeof usePendingTask>;
  onDone: () => void;
  onCancel: () => void;
};

/** One save: the role write, then the refreshed roles before the list returns. */
function saveRoleEdit(
  { site, edit }: Pick<SiteRoleEditProps, 'site' | 'edit'>,
  holder: ClientSelectItem | null,
  date: string,
): ReturnType<typeof endClientSiteRole> {
  return (
    edit.mode === 'end'
      ? endClientSiteRole({ roleId: edit.role.id, endsOn: date })
      : assignClientSiteRole({
          siteId: site.id,
          role: edit.kind,
          holderClientId: holder?.id ?? '',
          startsOn: date || null,
          replace: edit.replace,
        })
  ).catch(() => ({ success: false as const, error: 'unexpected_error' }));
}

/** The edit's holder, day and errors, and its submit. */
function useSiteRoleEditForm({ site, edit, settle, task, onDone }: SiteRoleEditProps) {
  const router = useRouter();
  const [holder, setHolder] = useState<ClientSelectItem | null>(null);
  // A change and an end need their day; a first entry may stay „seit unbekannt“.
  const [date, setDate] = useState(edit.mode === 'assign' && !edit.replace ? '' : berlinToday());
  const [holderError, setHolderError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = task;
  const dateRequired = edit.mode === 'end' || edit.replace;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const nextHolderError = edit.mode === 'assign' && !holder ? 'Bitte wähle einen Kunden.' : undefined;
    const nextDateError = dateRequired && !date ? 'Bitte gib ein Datum an.' : undefined;
    setHolderError(nextHolderError ?? null);
    setDateError(nextDateError ?? null);
    if (focusFirstInvalidField({ [HOLDER_FIELD_ID]: nextHolderError, [DATE_FIELD_ID]: nextDateError }))
      return;
    await run(async () => {
      const since = settle.markChange();
      const result = await saveRoleEdit({ site, edit }, holder, date);
      if (!result.success) {
        setError(
          describeFailure(
            result.error,
            ERROR_MESSAGES,
            'Speichern fehlgeschlagen. Bitte versuche es erneut.',
          ),
        );
        return;
      }
      router.refresh();
      await settle(since);
      onDone();
    });
  };

  const chooseHolder = (client: ClientSelectItem | null) => {
    setHolder(client);
    setHolderError(null);
  };
  const chooseDate = (next: string) => {
    setDate(next);
    setDateError(null);
  };
  return {
    holder,
    date,
    holderError,
    dateError,
    error,
    isPending,
    dateRequired,
    submit,
    chooseHolder,
    chooseDate,
  };
}

function dateDescription(edit: RoleEdit): string | undefined {
  if (edit.mode === 'end') return undefined;
  return edit.replace
    ? 'Die bisherige Rolle endet am Tag davor und bleibt im Verlauf.'
    : 'Leer lassen, wenn du nicht weißt, seit wann.';
}

function editTitle(edit: RoleEdit): string {
  const label = SITE_ROLE_LABELS[edit.kind];
  if (edit.mode === 'end') return `${label} ${edit.role.holderName} beenden`;
  return edit.replace ? `${label} wechseln` : `${label} eintragen`;
}

/** The form of one edit: the new holder and the day it starts, or the last day of a role. */
function SiteRoleEditForm(props: SiteRoleEditProps) {
  const { edit, onCancel } = props;
  const form = useSiteRoleEditForm(props);
  const dateLabel = edit.mode === 'end' ? 'Letzter Tag' : 'Gültig ab';
  return (
    <form onSubmit={form.submit} noValidate className="space-y-4 rounded-md border bg-muted/40 p-3">
      <p className="text-sm font-medium">{editTitle(edit)}</p>
      {edit.mode === 'assign' && (
        <Field label="Kunde" htmlFor={HOLDER_FIELD_ID} required error={form.holderError}>
          <ClientSelectWithCreate
            id={HOLDER_FIELD_ID}
            value={form.holder?.id ?? ''}
            selectedClient={form.holder}
            onValueChange={(_value, client) => form.chooseHolder(client)}
            disabled={form.isPending}
          />
        </Field>
      )}
      <Field
        label={dateLabel}
        htmlFor={DATE_FIELD_ID}
        required={form.dateRequired}
        error={form.dateError}
        description={dateDescription(edit)}
      >
        <DatePicker
          id={DATE_FIELD_ID}
          ariaLabel={dateLabel}
          value={toDate(form.date)}
          onChange={(next) => form.chooseDate(next ? toLocalDateString(next) : '')}
          disabled={form.isPending}
        />
      </Field>
      <ErrorText>{form.error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={form.isPending}>
          Abbrechen
        </Button>
        <Button type="submit" pending={form.isPending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

/** The three role kinds of one Einsatzort, each with its holders and history. */
function SiteRoleKindSections({
  roles,
  clientId,
  onEdit,
}: {
  roles: ClientSiteRole[];
  clientId: string;
  onEdit: (edit: RoleEdit) => void;
}) {
  const today = berlinToday();
  return SITE_ROLE_KINDS.map((kind) => (
    <SiteRoleKindSection
      key={kind}
      kind={kind}
      roles={roles}
      clientId={clientId}
      today={today}
      onEdit={onEdit}
    />
  ));
}

/**
 * The dated roles of one Einsatzort: who owns it, who manages it and who gets
 * its invoices, now and before. A change ends the previous role, which stays
 * in the history.
 */
export function ClientSiteRolesDialog({
  site,
  clientId,
  roles,
  onClose,
}: {
  /** Null while the dialog is closed. */
  site: ClientSite | null;
  clientId: string;
  /** Every role of the customer's Objekte; the dialog shows those of `site`. */
  roles: ClientSiteRole[];
  onClose: () => void;
}) {
  const { showBanner } = useBanner();
  const [edit, setEdit] = useState<RoleEdit | null>(null);
  const settle = useSettleOnChange(roles);
  const task = usePendingTask();
  const siteRoles = site ? roles.filter((role) => role.siteId === site.id) : [];
  const address = site ? formatSiteAddress(site) : '';

  return (
    <Dialog
      open={site !== null}
      pending={task.isPending}
      onOpenChange={(open) => {
        if (open) return;
        setEdit(null);
        onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Rollen am Einsatzort</DialogTitle>
          <DialogDescription>
            {site ? [site.name, address].filter(Boolean).join(' · ') : ''}
          </DialogDescription>
        </DialogHeader>
        {site && (
          <DialogBody className="space-y-3 py-1">
            {edit ? (
              <SiteRoleEditForm
                key={`${edit.mode}-${edit.kind}`}
                site={site}
                edit={edit}
                settle={settle}
                task={task}
                onCancel={() => setEdit(null)}
                onDone={() => {
                  setEdit(null);
                  showBanner({ variant: 'success', message: 'Rolle gespeichert.' });
                }}
              />
            ) : (
              <SiteRoleKindSections roles={siteRoles} clientId={clientId} onEdit={setEdit} />
            )}
          </DialogBody>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={task.isPending}
            onClick={() => {
              setEdit(null);
              onClose();
            }}
          >
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
