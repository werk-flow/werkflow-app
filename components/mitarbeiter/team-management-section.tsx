'use client';

import { useMemo, useState, useTransition } from 'react';
import { Loader2, Plus, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  addTeamMembership,
  createTeam,
  dissolveTeam,
  endTeamMembership,
  updateTeam,
} from '@/lib/qualifications/actions';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import type { QualificationWorkspace, Team } from '@/lib/qualifications/types';

type TeamManagementSectionProps = Pick<
  QualificationWorkspace,
  'teams' | 'teamMemberships' | 'employees'
>;

export function TeamManagementSection({
  teams,
  teamMemberships,
  employees,
}: TeamManagementSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [teamToDissolve, setTeamToDissolve] = useState<Team | null>(null);
  const [selectedEmployeeByTeam, setSelectedEmployeeByTeam] = useState<
    Record<string, string>
  >({});
  const [membershipWindowByTeam, setMembershipWindowByTeam] = useState<
    Record<string, { validFrom: string; validUntil: string }>
  >({});
  const today = getBusinessTodayIso();
  const activeTeams = teams.filter((team) => !team.dissolvedAt);
  const dissolvedTeams = teams.filter((team) => team.dissolvedAt);
  const employeeById = useMemo(
    () =>
      new Map(
        employees.map((employee) => [employee.employeeRecordId, employee])
      ),
    [employees]
  );

  const refresh = () => {
    startTransition(() => router.refresh());
  };

  const handleCreate = async () => {
    const result = await createTeam({ name, description });
    if (!result.success) {
      toast.error(
        result.error === 'duplicate_name'
          ? 'Ein aktives Team mit diesem Namen besteht bereits.'
          : 'Das Team konnte nicht angelegt werden.'
      );
      return;
    }
    setName('');
    setDescription('');
    refresh();
  };

  const handleRename = async (team: Team, value: string) => {
    const nextName = value.trim();
    if (!nextName) return;
    if (nextName === team.name) {
      setEditingTeamId(null);
      return;
    }
    const result = await updateTeam({
      teamId: team.id,
      name: nextName,
      description: team.description,
    });
    if (!result.success) {
      toast.error('Der Teamname konnte nicht geändert werden.');
      return;
    }
    setEditingTeamId(null);
    setEditingTeamName('');
    refresh();
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="team-create-heading">
        <div>
          <h2 id="team-create-heading" className="text-sm font-semibold">
            Team anlegen
          </h2>
          <p className="text-sm text-muted-foreground">
            Teams gruppieren Mitarbeiter für die Planung. Sie ändern keine
            Berechtigungen.
          </p>
        </div>
        <Card className="grid gap-3 p-4 md:grid-cols-[1fr_1.5fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="new-team-name">Name</Label>
            <Input
              id="new-team-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Kundendienst"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-team-description">
              Beschreibung (optional)
            </Label>
            <Textarea
              id="new-team-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Kurzer operativer Zweck"
              className="min-h-9"
              maxLength={1000}
            />
          </div>
          <Button
            type="button"
            className="self-end"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || isPending}
          >
            <Plus className="size-4" />
            Team anlegen
          </Button>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="active-teams-heading">
        <h2 id="active-teams-heading" className="text-sm font-semibold">
          Aktive Teams
        </h2>
        {activeTeams.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Noch keine Teams angelegt.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {activeTeams.map((team) => {
              const memberships = teamMemberships.filter(
                (membership) =>
                  membership.teamId === team.id &&
                  membership.validFrom <= today &&
                  (!membership.validUntil || membership.validUntil >= today)
              );
              const currentRecordIds = new Set(
                memberships.map((membership) => membership.employeeRecordId)
              );
              const availableEmployees = employees.filter(
                (employee) => !currentRecordIds.has(employee.employeeRecordId)
              );
              return (
                <Card
                  key={team.id}
                  className="gap-4 p-4"
                  data-testid="team-card"
                  data-team-name={team.name}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Users className="size-4 text-muted-foreground" />
                        {editingTeamId === team.id ? (
                          <Input
                            value={editingTeamName}
                            onChange={(event) =>
                              setEditingTeamName(event.target.value)
                            }
                            aria-label={`Neuer Name für ${team.name}`}
                            className="h-8 max-w-72"
                            maxLength={120}
                          />
                        ) : (
                          <h3 className="font-medium">{team.name}</h3>
                        )}
                      </div>
                      {team.description && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {team.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {editingTeamId === team.id ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!editingTeamName.trim()}
                            onClick={() =>
                              void handleRename(team, editingTeamName)
                            }
                          >
                            Speichern
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingTeamId(null)}
                          >
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
                        onClick={() => setTeamToDissolve(team)}
                      >
                        Auflösen
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {memberships.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Keine aktuellen Mitglieder.
                      </p>
                    ) : (
                      memberships.map((membership) => (
                        <div
                          key={membership.id}
                          className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
                        >
                          <span>
                            {employeeById.get(membership.employeeRecordId)
                              ?.displayName ?? 'Unbekannt'}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`${
                              employeeById.get(membership.employeeRecordId)
                                ?.displayName ?? 'Teammitglied'
                            } zum Tagesende aus ${team.name} entfernen`}
                            onClick={async () => {
                              const result = await endTeamMembership({
                                membershipId: membership.id,
                                validUntil: today,
                              });
                              if (!result.success) {
                                toast.error(
                                  'Die Teamzugehörigkeit konnte nicht beendet werden.'
                                );
                                return;
                              }
                              refresh();
                            }}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={selectedEmployeeByTeam[team.id] ?? ''}
                      onValueChange={(value) =>
                        setSelectedEmployeeByTeam((current) => ({
                          ...current,
                          [team.id]: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label={'Mitglied zu ' + team.name + ' hinzufügen'}
                      >
                        <SelectValue placeholder="Mitarbeiter auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableEmployees.map((employee) => (
                          <SelectItem
                            key={employee.employeeRecordId}
                            value={employee.employeeRecordId}
                          >
                            {employee.displayName}
                            {!employee.userId ? ' (ohne Zugang)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      value={
                        membershipWindowByTeam[team.id]?.validFrom ?? today
                      }
                      onChange={(event) =>
                        setMembershipWindowByTeam((current) => ({
                          ...current,
                          [team.id]: {
                            validFrom: event.target.value,
                            validUntil:
                              current[team.id]?.validUntil ?? '',
                          },
                        }))
                      }
                      aria-label={`Teamzugehörigkeit zu ${team.name} gültig ab`}
                    />
                    <Input
                      type="date"
                      value={
                        membershipWindowByTeam[team.id]?.validUntil ?? ''
                      }
                      onChange={(event) =>
                        setMembershipWindowByTeam((current) => ({
                          ...current,
                          [team.id]: {
                            validFrom:
                              current[team.id]?.validFrom ?? today,
                            validUntil: event.target.value,
                          },
                        }))
                      }
                      aria-label={`Teamzugehörigkeit zu ${team.name} gültig bis`}
                    />
                    <Button
                      variant="outline"
                      disabled={!selectedEmployeeByTeam[team.id]}
                      onClick={async () => {
                        const employeeRecordId =
                          selectedEmployeeByTeam[team.id];
                        if (!employeeRecordId) return;
                        const result = await addTeamMembership({
                          teamId: team.id,
                          employeeRecordId,
                          validFrom:
                            membershipWindowByTeam[team.id]?.validFrom ?? today,
                          validUntil:
                            membershipWindowByTeam[team.id]?.validUntil || null,
                        });
                        if (!result.success) {
                          toast.error(
                            result.error === 'overlap'
                              ? 'Diese Teamzugehörigkeit besteht bereits.'
                              : 'Das Teammitglied konnte nicht hinzugefügt werden.'
                          );
                          return;
                        }
                        setSelectedEmployeeByTeam((current) => ({
                          ...current,
                          [team.id]: '',
                        }));
                        refresh();
                      }}
                    >
                      Hinzufügen
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {dissolvedTeams.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Aufgelöste Teams</h2>
          <div className="flex flex-wrap gap-2">
            {dissolvedTeams.map((team) => (
              <span
                key={team.id}
                className="rounded-md border px-2.5 py-1 text-sm text-muted-foreground"
              >
                {team.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Ansicht wird aktualisiert…
        </p>
      )}
      <AlertDialog
        open={Boolean(teamToDissolve)}
        onOpenChange={(open) => !open && setTeamToDissolve(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Team auflösen?</AlertDialogTitle>
            <AlertDialogDescription>
              {teamToDissolve?.name} bleibt mit seiner Historie erhalten, steht
              aber nicht mehr für neue Planungen zur Auswahl.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const team = teamToDissolve;
                if (!team) return;
                void dissolveTeam({ teamId: team.id }).then((result) => {
                  if (!result.success) {
                    toast.error('Das Team konnte nicht aufgelöst werden.');
                    return;
                  }
                  setTeamToDissolve(null);
                  refresh();
                });
              }}
            >
              Team auflösen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
