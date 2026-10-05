'use client';

import { Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { QualificationWorkspace, Team } from '@/lib/qualifications/types';
import { toLocalDateString, parseIsoLocalDate } from '@/lib/utils';
import type { TeamManagementController } from './use-team-management';
import { teamNameFieldId } from './use-team-management-team-edits';

type TeamManagementCardPartProps = {
  team: Team;
  management: TeamManagementController;
};

type TeamMembershipRows = NonNullable<ReturnType<TeamManagementController['activeMembershipsByTeam']['get']>>;

function TeamManagementCardHeader({
  team,
  isOptimistic,
  management,
}: TeamManagementCardPartProps & { isOptimistic: boolean }) {
  const {
    editingTeamId,
    setEditingTeamId,
    editingTeamName,
    setEditingTeamName,
    renameError,
    anyBusy,
    handleRename,
    setTeamToDissolve,
  } = management;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          {editingTeamId === team.id ? (
            <Field
              label={`Neuer Name für ${team.name}`}
              hideLabel
              htmlFor={teamNameFieldId(team.id)}
              error={renameError}
              className="max-w-72 flex-1"
            >
              <Input
                autoFocus
                value={editingTeamName}
                onChange={(event) => setEditingTeamName(event.target.value)}
                className="h-8"
                maxLength={120}
              />
            </Field>
          ) : (
            <h3 className="font-medium">{team.name}</h3>
          )}
          <InlinePending active={isOptimistic} label="Teamname wird gespeichert" />
        </div>
        {team.description && <p className="mt-1 text-sm text-muted-foreground">{team.description}</p>}
      </div>
      <div className="flex flex-wrap gap-1">
        {editingTeamId === team.id ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={anyBusy}
              onClick={() => void handleRename(team, editingTeamName)}
            >
              Speichern
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditingTeamId(null)}>
              Abbrechen
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditingTeamId(team.id);
              setEditingTeamName(team.name);
            }}
          >
            Umbenennen
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={anyBusy}
          onClick={() => setTeamToDissolve(team)}
        >
          Auflösen
        </Button>
      </div>
    </div>
  );
}

function TeamManagementCardMembers({
  team,
  memberships,
  management,
}: TeamManagementCardPartProps & { memberships: TeamMembershipRows }) {
  const { employeeById, anyBusy, isBusy, handleEndMembership } = management;
  return (
    <div className="space-y-2">
      {memberships.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine aktuellen Mitglieder.</p>
      ) : (
        memberships.map(({ item: membership, isOptimistic: isPendingMember }) => (
          <div
            key={membership.id}
            data-testid="team-member-row"
            className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              {employeeById.get(membership.employeeRecordId)?.displayName ?? 'Unbekannt'}
              <InlinePending
                active={isPendingMember || isBusy(`end:${membership.id}`)}
                label="Teamzugehörigkeit wird gespeichert"
              />
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`${
                employeeById.get(membership.employeeRecordId)?.displayName ?? 'Teammitglied'
              } zum Tagesende aus ${team.name} entfernen`}
              disabled={anyBusy || isPendingMember}
              onClick={() => handleEndMembership(membership)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

function TeamManagementCardAddMemberForm({
  team,
  availableEmployees,
  management,
}: TeamManagementCardPartProps & {
  availableEmployees: QualificationWorkspace['employees'];
}) {
  const {
    today,
    anyBusy,
    selectedEmployeeByTeam,
    setSelectedEmployeeByTeam,
    membershipWindowByTeam,
    setMembershipWindowByTeam,
    addFieldErrorsByTeam,
    addErrorByTeam,
    handleAddMembership,
  } = management;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field
        label="Mitarbeiter"
        htmlFor={`team-${team.id}-member`}
        required
        error={addFieldErrorsByTeam[team.id]?.member}
        className="gap-1.5"
      >
        <SearchableSelect
          ariaLabel={'Mitglied zu ' + team.name + ' hinzufügen'}
          options={availableEmployees.map((employee) => ({
            value: employee.employeeRecordId,
            label: `${employee.displayName}${!employee.userId ? ' (ohne Zugang)' : ''}`,
          }))}
          value={selectedEmployeeByTeam[team.id] ?? ''}
          onChange={(value) =>
            setSelectedEmployeeByTeam((current) => ({
              ...current,
              [team.id]: value,
            }))
          }
          placeholder="Mitarbeiter auswählen"
          searchPlaceholder="Mitarbeiter suchen …"
          emptyMessage="Kein Mitarbeiter gefunden"
        />
      </Field>
      <Field label="Gültig ab" htmlFor={`team-${team.id}-valid-from`} className="gap-1.5">
        <DatePicker
          ariaLabel={`Teamzugehörigkeit zu ${team.name} gültig ab`}
          value={parseIsoLocalDate(membershipWindowByTeam[team.id]?.validFrom ?? today)}
          onChange={(date) =>
            setMembershipWindowByTeam((current) => ({
              ...current,
              [team.id]: {
                validFrom: date ? toLocalDateString(date) : '',
                validUntil: current[team.id]?.validUntil ?? '',
              },
            }))
          }
        />
      </Field>
      <Field
        label="Gültig bis (optional)"
        htmlFor={`team-${team.id}-valid-until`}
        error={addFieldErrorsByTeam[team.id]?.validUntil}
        className="gap-1.5"
      >
        <DatePicker
          ariaLabel={`Teamzugehörigkeit zu ${team.name} gültig bis`}
          value={parseIsoLocalDate(membershipWindowByTeam[team.id]?.validUntil ?? '')}
          onChange={(date) =>
            setMembershipWindowByTeam((current) => ({
              ...current,
              [team.id]: {
                validFrom: current[team.id]?.validFrom ?? today,
                validUntil: date ? toLocalDateString(date) : '',
              },
            }))
          }
        />
      </Field>
      <Button variant="outline" disabled={anyBusy} onClick={() => handleAddMembership(team)}>
        Hinzufügen
      </Button>
      <div className="sm:col-span-2">
        <ErrorText>{addErrorByTeam[team.id]}</ErrorText>
      </div>
    </div>
  );
}

type TeamManagementTeamCardProps = TeamManagementCardPartProps & {
  /** The team shows an unconfirmed rename. */
  isOptimistic: boolean;
};

/** One confirmed active team: name and actions, current members, add form. */
export function TeamManagementTeamCard({ team, isOptimistic, management }: TeamManagementTeamCardProps) {
  const { employees, activeMembershipsByTeam } = management;
  const memberships = activeMembershipsByTeam.get(team.id) ?? [];
  const currentRecordIds = new Set(memberships.map((row) => row.item.employeeRecordId));
  const availableEmployees = employees.filter((employee) => !currentRecordIds.has(employee.employeeRecordId));
  return (
    <Card className="gap-4 p-4" data-testid="team-card" data-team-name={team.name}>
      <TeamManagementCardHeader team={team} isOptimistic={isOptimistic} management={management} />

      <TeamManagementCardMembers team={team} memberships={memberships} management={management} />

      <TeamManagementCardAddMemberForm
        team={team}
        availableEmployees={availableEmployees}
        management={management}
      />
    </Card>
  );
}
