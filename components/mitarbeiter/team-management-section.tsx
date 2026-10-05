'use client';

import { Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import { TeamManagementCreateForm } from './team-management-create-form';
import { TeamManagementDissolveDialog } from './team-management-dissolve-dialog';
import { TeamManagementTeamCard } from './team-management-team-card';
import { useTeamManagement, type TeamManagementInput } from './use-team-management';

export function TeamManagementSection({ teams, teamMemberships, employees }: TeamManagementInput) {
  const management = useTeamManagement({ teams, teamMemberships, employees });
  const { activeTeams, dissolvedTeams } = management;

  return (
    <div className="space-y-6">
      <TeamManagementCreateForm management={management} />

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
            {activeTeams.map(({ item: team, isOptimistic, tempId }) => {
              if (tempId !== null) {
                return (
                  <Card
                    key={team.id}
                    className="gap-4 p-4 opacity-70"
                    role="status"
                    aria-label="Team wird gespeichert"
                  >
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground" />
                      <h3 className="font-medium">{team.name}</h3>
                      <InlinePending active label="Team wird gespeichert" />
                    </div>
                  </Card>
                );
              }
              return (
                <TeamManagementTeamCard
                  key={team.id}
                  team={team}
                  isOptimistic={isOptimistic}
                  management={management}
                />
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
              <span key={team.id} className="rounded-md border px-2.5 py-1 text-sm text-muted-foreground">
                {team.name}
              </span>
            ))}
          </div>
        </section>
      )}

      <TeamManagementDissolveDialog management={management} />
    </div>
  );
}
