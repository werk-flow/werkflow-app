'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { Plus, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
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
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import {
  addTeamMembership,
  createTeam,
  dissolveTeam,
  endTeamMembership,
  updateTeam,
} from '@/lib/qualifications/actions';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import type { QualificationWorkspace, Team } from '@/lib/qualifications/types';
import { toLocalDateString } from '@/lib/utils';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';

function isoToLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

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
  const { showBanner } = useBanner();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [teamToDissolve, setTeamToDissolve] = useState<Team | null>(null);
  const [dissolveError, setDissolveError] = useState<string | null>(null);
  const [addErrorByTeam, setAddErrorByTeam] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
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

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);
  useBusinessDayRefresh(refresh);
  const activeMembershipsByTeam = useMemo(() => {
    const membershipsByTeam = new Map<string, typeof teamMemberships>();
    for (const membership of teamMemberships) {
      if (
        membership.validFrom > today ||
        (membership.validUntil && membership.validUntil < today)
      ) {
        continue;
      }
      const memberships = membershipsByTeam.get(membership.teamId) ?? [];
      memberships.push(membership);
      membershipsByTeam.set(membership.teamId, memberships);
    }
    return membershipsByTeam;
  }, [teamMemberships, today]);

  const handleCreate = async () => {
    setPendingAction('create');
    setCreateError(null);
    try {
      const result = await createTeam({ name, description });
      if (!result.success) {
        setCreateError(
          result.error === 'duplicate_name'
            ? 'Ein aktives Team mit diesem Namen besteht bereits.'
            : 'Das Team konnte nicht angelegt werden.'
        );
        return;
      }
      setName('');
      setDescription('');
      showBanner({ variant: 'success', message: 'Das Team wurde angelegt.' });
      refresh();
    } catch {
      setCreateError('Das Team konnte nicht angelegt werden.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleRename = async (team: Team, value: string) => {
    const nextName = value.trim();
    if (!nextName) return;
    if (nextName === team.name) {
      setEditingTeamId(null);
      return;
    }
    setPendingAction(`rename:${team.id}`);
    try {
      const result = await updateTeam({
        teamId: team.id,
        name: nextName,
        description: team.description,
      });
      if (!result.success) {
        showBanner({
          variant: 'error',
          message: 'Der Teamname konnte nicht geändert werden.',
        });
        return;
      }
      setEditingTeamId(null);
      setEditingTeamName('');
      showBanner({
        variant: 'success',
        message: 'Der Teamname wurde geändert.',
      });
      refresh();
    } catch {
      showBanner({
        variant: 'error',
        message: 'Der Teamname konnte nicht geändert werden.',
      });
    } finally {
      setPendingAction(null);
    }
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
            disabled={!name.trim() || pendingAction !== null || isPending}
          >
            <Plus className="size-4" />
            Team anlegen
          </Button>
          <div className="md:col-span-3">
            <ErrorText>{createError}</ErrorText>
          </div>
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
              const memberships = activeMembershipsByTeam.get(team.id) ?? [];
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
                            autoFocus
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
                            disabled={!editingTeamName.trim() || pendingAction !== null}
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
                        disabled={pendingAction !== null}
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
                          data-testid="team-member-row"
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
                            disabled={pendingAction !== null}
                            onClick={async () => {
                              setPendingAction(`end:${membership.id}`);
                              try {
                                const result = await endTeamMembership({
                                  membershipId: membership.id,
                                  validUntil: today,
                                });
                                if (!result.success) {
                                  showBanner({
                                    variant: 'error',
                                    message:
                                      'Die Teamzugehörigkeit konnte nicht beendet werden.',
                                  });
                                  return;
                                }
                                showBanner({
                                  variant: 'success',
                                  message:
                                    'Die Teamzugehörigkeit wurde zum Tagesende beendet.',
                                });
                                refresh();
                              } catch {
                                showBanner({
                                  variant: 'error',
                                  message:
                                    'Die Teamzugehörigkeit konnte nicht beendet werden.',
                                });
                              } finally {
                                setPendingAction(null);
                              }
                            }}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
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
                    <div className="space-y-1.5">
                      <Label htmlFor={`team-${team.id}-valid-from`}>Gültig ab</Label>
                      <DatePicker
                        id={`team-${team.id}-valid-from`}
                        ariaLabel={`Teamzugehörigkeit zu ${team.name} gültig ab`}
                        value={isoToLocalDate(
                          membershipWindowByTeam[team.id]?.validFrom ?? today
                        )}
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
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`team-${team.id}-valid-until`}>
                        Gültig bis (optional)
                      </Label>
                      <DatePicker
                        id={`team-${team.id}-valid-until`}
                        ariaLabel={`Teamzugehörigkeit zu ${team.name} gültig bis`}
                        value={isoToLocalDate(
                          membershipWindowByTeam[team.id]?.validUntil ?? ''
                        )}
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
                    </div>
                    <Button
                      variant="outline"
                      disabled={
                        !selectedEmployeeByTeam[team.id] || pendingAction !== null
                      }
                      onClick={async () => {
                        const employeeRecordId =
                          selectedEmployeeByTeam[team.id];
                        if (!employeeRecordId) return;
                        const membershipWindow = membershipWindowByTeam[team.id];
                        const validFrom = membershipWindow?.validFrom ?? today;
                        const validUntil = membershipWindow?.validUntil || null;
                        const setAddError = (message: string | null) =>
                          setAddErrorByTeam((current) => {
                            const next = { ...current };
                            if (message) next[team.id] = message;
                            else delete next[team.id];
                            return next;
                          });
                        setAddError(null);
                        if (validUntil && validUntil < validFrom) {
                          setAddError(
                            '„Gültig bis“ darf nicht vor „Gültig ab“ liegen.'
                          );
                          return;
                        }
                        setPendingAction(`add:${team.id}`);
                        try {
                          const result = await addTeamMembership({
                            teamId: team.id,
                            employeeRecordId,
                            validFrom,
                            validUntil,
                          });
                          if (!result.success) {
                            setAddError(
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
                          setMembershipWindowByTeam((current) => ({
                            ...current,
                            [team.id]: { validFrom: today, validUntil: '' },
                          }));
                          showBanner({
                            variant: 'success',
                            message: 'Das Teammitglied wurde hinzugefügt.',
                          });
                          refresh();
                        } catch {
                          setAddError(
                            'Das Teammitglied konnte nicht hinzugefügt werden.'
                          );
                        } finally {
                          setPendingAction(null);
                        }
                      }}
                    >
                      Hinzufügen
                    </Button>
                    <div className="sm:col-span-2">
                      <ErrorText>{addErrorByTeam[team.id]}</ErrorText>
                    </div>
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

      <AlertDialog
        open={Boolean(teamToDissolve)}
        onOpenChange={(open) => {
          if (!open) {
            setTeamToDissolve(null);
            setDissolveError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Team auflösen?</AlertDialogTitle>
            <AlertDialogDescription>
              {teamToDissolve?.name} bleibt mit seiner Historie erhalten, steht
              aber nicht mehr für neue Planungen zur Auswahl.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorText>{dissolveError}</ErrorText>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pendingAction !== null}
              onClick={(event) => {
                event.preventDefault();
                const team = teamToDissolve;
                if (!team) return;
                setDissolveError(null);
                setPendingAction(`dissolve:${team.id}`);
                void dissolveTeam({ teamId: team.id }).then((result) => {
                  if (!result.success) {
                    setDissolveError('Das Team konnte nicht aufgelöst werden.');
                    return;
                  }
                  setTeamToDissolve(null);
                  showBanner({
                    variant: 'success',
                    message: 'Das Team wurde aufgelöst.',
                  });
                  refresh();
                }).catch(() => {
                  setDissolveError('Das Team konnte nicht aufgelöst werden.');
                }).finally(() => {
                  setPendingAction(null);
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
