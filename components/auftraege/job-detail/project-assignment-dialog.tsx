'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const PROJECT_FIELD_ID = 'project-assignment-project';
const PROJECT_REQUIRED_MESSAGE = 'Bitte wähle ein Projekt aus.';

interface ProjectAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProjectId?: string | null;
  currentClientId?: string | null;
  title?: string;
  isSaving?: boolean;
  /** Failure of the last save; the dialog stays open while it is set. */
  saveError?: string | null;
  /** Hands back the chosen project's option: its number, label and customer. */
  onSave: (project: JobEntityOption) => Promise<void> | void;
}

/**
 * Links a job to a project. The choices are searched on the server: open
 * projects of the job's customer and those without a customer.
 */
export function ProjectAssignmentDialog({
  open,
  onOpenChange,
  currentProjectId,
  currentClientId,
  title = 'Projekt zuweisen',
  isSaving = false,
  saveError,
  onSave,
}: ProjectAssignmentDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(currentProjectId ?? '');
  const [attempted, setAttempted] = useState(false);
  const projectSearch = useJobEntityOptions(
    { kind: 'projects', purpose: 'job-project', clientId: currentClientId ?? undefined },
    selectedProjectId ? [selectedProjectId] : [],
  );

  // Every opening, and a new project while open, resets the draft during render, never in an effect.
  const [resetFor, setResetFor] = useState({ open: false, currentProjectId });
  if (open !== resetFor.open || currentProjectId !== resetFor.currentProjectId) {
    setResetFor({ open, currentProjectId });
    if (open) {
      setSelectedProjectId(currentProjectId ?? '');
      setAttempted(false);
    }
  }

  const selectedProject = projectSearch.options.find((option) => option.value === selectedProjectId);
  const projectError = attempted && !selectedProject ? PROJECT_REQUIRED_MESSAGE : undefined;

  const handleSave = async () => {
    if (!selectedProject) {
      setAttempted(true);
      focusFirstInvalidField({ [PROJECT_FIELD_ID]: PROJECT_REQUIRED_MESSAGE });
      return;
    }
    await onSave(selectedProject);
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
              options={projectSearch.options}
              onSearchChange={projectSearch.onSearchChange}
              loading={projectSearch.loading}
              loadError={projectSearch.loadError}
              onRetryLoad={projectSearch.onRetryLoad}
              onLoadMore={projectSearch.onLoadMore}
              value={selectedProjectId}
              onChange={setSelectedProjectId}
              placeholder="Projekt auswählen"
              searchPlaceholder="Projekt suchen…"
              emptyMessage={
                currentClientId ? 'Kein offenes Projekt für diesen Kunden gefunden' : 'Kein Projekt gefunden'
              }
              disabled={isSaving}
            />
          </Field>

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
