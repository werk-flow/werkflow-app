'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import {
  expandTeamForAssignment,
  getAssignmentTeamOptions,
} from '@/lib/qualifications/actions';

import { SearchableMultiSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';

export type OrgMemberOption = {
  userId: string;
  firstName: string;
  lastName: string;
  role?: string;
};

interface EmployeeMultiSelectProps {
  members: OrgMemberOption[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  assessedForDate?: string | null;
  onTeamApplied?: (teamId: string | null) => void;
  onTeamExpansionPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
}

function getMemberName(m: OrgMemberOption): string {
  const name = `${m.firstName} ${m.lastName}`.trim();
  return name || 'Unbenannt';
}

export function EmployeeMultiSelect({
  members,
  selectedIds,
  onSelectionChange,
  assessedForDate,
  onTeamApplied,
  onTeamExpansionPendingChange,
  disabled = false,
}: EmployeeMultiSelectProps) {
  const { showBanner } = useBanner();
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getAssignmentTeamOptions().then((result) => {
      if (active && result.success) setTeams(result.teams);
    }).catch(() => {
      // Team shortcuts remain hidden when the options cannot be loaded.
    });
    return () => {
      active = false;
    };
  }, []);
  const options: SearchableSelectOption[] = useMemo(
    () =>
      members.map((m) => ({
        value: m.userId,
        label: getMemberName(m),
      })),
    [members]
  );

  return (
    <div className="space-y-2">
      {teams.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Team für die Zuweisung übernehmen"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            Team übernehmen:
          </span>
          {teams.map((team) => (
            <Button
              key={team.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              aria-busy={pendingTeamId === team.id || undefined}
              disabled={
                disabled ||
                (pendingTeamId !== null && pendingTeamId !== team.id)
              }
              onClick={async () => {
                if (pendingTeamId !== null) return;
                setPendingTeamId(team.id);
                onTeamExpansionPendingChange?.(true);
                try {
                  const result = await expandTeamForAssignment({
                    teamId: team.id,
                    assessedForDate,
                  });
                  if (!result.success) {
                    showBanner({ variant: 'error', message: 'Das Team konnte nicht übernommen werden.' });
                    return;
                  }
                  onSelectionChange([
                    ...new Set([...selectedIds, ...result.userIds]),
                  ]);
                  onTeamApplied?.(result.teamSourceId);
                  if (result.skippedNames.length > 0) {
                    const verb = result.skippedNames.length === 1 ? 'wurde' : 'wurden';
                    showBanner({
                      variant: 'info',
                      message: `${result.skippedNames.join(', ')} ${verb} nicht übernommen, da kein aktiver App-Zugang verknüpft ist.`,
                    });
                  }
                } catch {
                  showBanner({ variant: 'error', message: 'Das Team konnte nicht übernommen werden.' });
                } finally {
                  setPendingTeamId(null);
                  onTeamExpansionPendingChange?.(false);
                }
              }}
            >
              {team.name}
            </Button>
          ))}
        </div>
      )}
      <SearchableMultiSelect
        options={options}
        selectedIds={selectedIds}
        onSelectionChange={(ids) => {
          onSelectionChange(ids);
          onTeamApplied?.(null);
        }}
        placeholder="Mitarbeiter zuweisen"
        selectedLabel={(count) =>
          count === 1 ? '1 Mitarbeiter' : `${count} Mitarbeiter`
        }
        searchPlaceholder="Mitarbeiter suchen..."
        emptyMessage="Kein Mitarbeiter gefunden"
        disabled={disabled}
      />
    </div>
  );
}
