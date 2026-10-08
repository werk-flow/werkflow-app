'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { OptionsLoadError } from '../shared/options-load-error';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { ProjectWithDetails } from '@/lib/jobs/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const PROJECT_FIELD_ID = 'project-assignment-project';
const PROJECT_REQUIRED_MESSAGE = 'Bitte wähle ein Projekt aus.';

interface ProjectAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectWithDetails[];
  currentProjectId?: string | null;
  currentClientId?: string | null;
  title?: string;
  isSaving?: boolean;
  /** Failure of the last save; the dialog stays open while it is set. */
  saveError?: string | null;
  /** The on-demand option load; its failure shows with a retry. */
  optionsLoad?: { error: string | null; retry: () => void; isLoading: boolean } | undefined;
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
  saveError,
  optionsLoad,
  onSave,
}: ProjectAssignmentDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(currentProjectId ?? '');
  const [attempted, setAttempted] = useState(false);

  // Every opening, and a new project while open, resets the draft during render, never in an effect.
  const [resetFor, setResetFor] = useState({ open: false, currentProjectId });
  if (open !== resetFor.open || currentProjectId !== resetFor.currentProjectId) {
    setResetFor({ open, currentProjectId });
    if (open) {
      setSelectedProjectId(currentProjectId ?? '');
      setAttempted(false);
    }
  }

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
    [projects],
  );

  const filteredProjects = useMemo(() => {
    if (!currentClientId) return activeProjects;
    return activeProjects.filter((project) => project.clientId === currentClientId || !project.clientId);
  }, [activeProjects, currentClientId]);

  const projectOptions = useMemo(
    () =>
      filteredProjects.map((project) => ({
        value: project.id,
        label: project.projectNumber ? `${project.projectNumber} – ${project.name}` : project.name,
      })),
    [filteredProjects],
  );

  const projectError = attempted && !selectedProjectId ? PROJECT_REQUIRED_MESSAGE : undefined;

  const handleSave = async () => {
    if (!selectedProjectId) {
      setAttempted(true);
      focusFirstInvalidField({ [PROJECT_FIELD_ID]: PROJECT_REQUIRED_MESSAGE });
      return;
    }
    await onSave(selectedProjectId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isSaving}>
      <DialogContent size="md" className="overflow-visible sm:top-[47%] sm:translate-y-[-47%]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="Projekt" hideLabel htmlFor={PROJECT_FIELD_ID} error={projectError}>
            <SearchableSelect
              options={projectOptions}
              value={selectedProjectId}
              onChange={setSelectedProjectId}
              placeholder="Projekt auswählen"
              searchPlaceholder="Projekt suchen…"
              emptyMessage={
                currentClientId ? 'Kein Projekt für diesen Kunden vorhanden' : 'Kein Projekt gefunden'
              }
              disabled={isSaving}
            />
          </Field>

          {currentClientId && filteredProjects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Dem ausgewählten Kunden sind keine aktiven Projekte zugeordnet.
            </p>
          )}

          {optionsLoad && (
            <OptionsLoadError
              error={optionsLoad.error}
              onRetry={optionsLoad.retry}
              retrying={optionsLoad.isLoading}
            />
          )}
          <ErrorText>{saveError}</ErrorText>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} onClick={handleSave} disabled={isSaving}>
              Speichern
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
