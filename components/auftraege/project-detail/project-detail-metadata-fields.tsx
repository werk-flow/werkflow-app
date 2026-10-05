import type { Dispatch, SetStateAction } from 'react';

import { Badge } from '@/components/ui/badge';
import type { MetadataField } from '@/components/shared/metadata-section';
import { type DerivedProjectStatus, type Project, PROJECT_STATUS_LABELS } from '@/lib/jobs/types';
import { updateProject } from '@/lib/projects/actions';
import { PROJECT_STATUS_CLASSES } from '../status-classes';
import { formatGermanDate, formatGermanDateTime } from '@/lib/utils';

type ProjectDetailMetadataOptions = {
  project: Project;
  liveProject: Project;
  liveDerivedStatus: DerivedProjectStatus;
  isAdminOrManager: boolean;
  setLiveProject: Dispatch<SetStateAction<Project>>;
};

/** The "Details" fields of a project; inline edits adopt the saved project. */
export function buildProjectDetailMetadataFields({
  project,
  liveProject,
  liveDerivedStatus,
  isAdminOrManager,
  setLiveProject,
}: ProjectDetailMetadataOptions): MetadataField[] {
  return [
    {
      label: 'Projektnummer',
      value: <span className="font-mono text-xs">{liveProject.projectNumber}</span>,
    },
    {
      label: 'Titel',
      value: liveProject.name,
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: liveProject.name,
            onSave: async (v) => {
              const result = await updateProject(project.id, { name: v });
              if (result.success) setLiveProject(result.project);
            },
          }
        : undefined,
    },
    {
      label: 'Beschreibung',
      value: liveProject.description || <span className="text-muted-foreground">Keine Beschreibung</span>,
      editableConfig: isAdminOrManager
        ? {
            type: 'textarea',
            currentValue: liveProject.description ?? '',
            onSave: async (v) => {
              const result = await updateProject(project.id, { description: v });
              if (result.success) setLiveProject(result.project);
            },
            placeholder: 'Beschreibung hinzufügen…',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Status',
      value: (
        <Badge variant="secondary" className={PROJECT_STATUS_CLASSES[liveDerivedStatus.status]}>
          {PROJECT_STATUS_LABELS[liveDerivedStatus.status]}
        </Badge>
      ),
    },
    {
      label: 'Geplanter Beginn',
      value: formatGermanDate(liveProject.plannedStartDate, { empty: '—' }),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: liveProject.plannedStartDate ?? '',
            onSave: async (v) => {
              const result = await updateProject(project.id, {
                plannedStartDate: v,
              });
              if (result.success) setLiveProject(result.project);
            },
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geplantes Ende',
      value: formatGermanDate(liveProject.plannedEndDate, { empty: '—' }),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: liveProject.plannedEndDate ?? '',
            onSave: async (v) => {
              const result = await updateProject(project.id, {
                plannedEndDate: v,
              });
              if (result.success) setLiveProject(result.project);
            },
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Erstellt am',
      value: formatGermanDateTime(liveProject.createdAt),
    },
  ];
}
