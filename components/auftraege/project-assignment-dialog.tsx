'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { ProjectWithDetails } from '@/lib/jobs/types';

interface ProjectAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectWithDetails[];
  currentProjectId?: string | null;
  currentClientId?: string | null;
  title?: string;
  isSaving?: boolean;
  onSave: (projectId: string) => Promise<void> | void;
}

export function ProjectAssignmentDialog({
  open,
  onOpenChange,
  projects,
  currentProjectId,
  currentClientId,
  title = 'Projekt zuweisen',
  isSaving = false,
  onSave,
}: ProjectAssignmentDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(
    currentProjectId ?? ''
  );

  useEffect(() => {
    if (!open) return;
    setSelectedProjectId(currentProjectId ?? '');
  }, [open, currentProjectId]);

  const activeProjects = useMemo(
    () =>
      projects.filter((project) => {
        const status =
          project.statusOverride ??
          (project.completedJobCount === project.jobCount && project.jobCount > 0
            ? 'abgeschlossen'
            : 'nicht_begonnen');
        return status !== 'abgeschlossen';
      }),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    if (!currentClientId) return activeProjects;
    return activeProjects.filter(
      (project) => project.clientId === currentClientId || !project.clientId
    );
  }, [activeProjects, currentClientId]);

  const projectOptions = useMemo(
    () =>
      filteredProjects.map((project) => ({
        value: project.id,
        label: project.projectNumber
          ? `${project.projectNumber} – ${project.name}`
          : project.name,
      })),
    [filteredProjects]
  );

  const handleSave = async () => {
    await onSave(selectedProjectId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-visible sm:top-[47%] sm:max-w-[420px] sm:translate-y-[-47%]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <SearchableSelect
            options={projectOptions}
            value={selectedProjectId}
            onChange={setSelectedProjectId}
            placeholder="Projekt auswählen"
            searchPlaceholder="Projekt suchen..."
            emptyMessage={
              currentClientId
                ? 'Kein Projekt für diesen Kunden vorhanden'
                : 'Kein Projekt gefunden'
            }
            disabled={isSaving}
          />

          {currentClientId && filteredProjects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Dem ausgewählten Kunden sind keine aktiven Projekte zugeordnet.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !selectedProjectId}
            >
              {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
