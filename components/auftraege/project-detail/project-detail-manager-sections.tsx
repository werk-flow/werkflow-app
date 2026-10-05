'use client';

import { useState } from 'react';

import { ApplyWorkTemplateCard } from '@/components/arbeitsvorlagen/apply-work-template-card';
import { JobMaterialsSection } from '@/components/inventar/job-materials-section';
import { RegionLoadError } from '@/components/shared/region-load-error';
import type { InventoryLocation, InventoryPickerOption, ProjectMaterialSummary } from '@/lib/inventory/types';
import type { JobInstructionItemWithDetails, Project } from '@/lib/jobs/types';
import { JobInstructionItemsCard } from '../instructions/job-instruction-items-card';
import { ProjectQualificationSection } from './project-qualification-section';

type ProjectDetailManagerSectionsProps = {
  liveProject: Project;
  // Null: the server read failed, and the region shows the failure.
  instructionItems: JobInstructionItemWithDetails[] | null;
  materialSummary: ProjectMaterialSummary | null;
  inventoryItems: InventoryPickerOption[] | null;
  inventoryLocations: InventoryLocation[] | null;
};

/** The manager-only planning sections: instructions, template, qualifications, materials. */
export function ProjectDetailManagerSections({
  liveProject,
  instructionItems,
  materialSummary,
  inventoryItems,
  inventoryLocations,
}: ProjectDetailManagerSectionsProps) {
  const [instructionRefreshSignal, setInstructionRefreshSignal] = useState(0);

  return (
    <>
      {instructionItems ? (
        <JobInstructionItemsCard
          projectId={liveProject.id}
          initialItems={instructionItems}
          isAdminOrManager
          currentUserActor={null}
          refreshSignal={instructionRefreshSignal}
        />
      ) : (
        <RegionLoadError>Arbeitsanweisungen konnten nicht geladen werden.</RegionLoadError>
      )}
      <ApplyWorkTemplateCard
        targetType="project"
        targetId={liveProject.id}
        onApplied={() => setInstructionRefreshSignal((value) => value + 1)}
      />
      <ProjectQualificationSection projectId={liveProject.id} />
      {materialSummary && inventoryItems && inventoryLocations ? (
        <JobMaterialsSection
          projectId={liveProject.id}
          initialLines={materialSummary.directLines}
          inheritedJobGroups={materialSummary.jobGroups}
          totals={materialSummary.totals}
          inventoryItems={inventoryItems}
          locations={inventoryLocations}
          isAdminOrManager
        />
      ) : (
        <RegionLoadError>Material und Inventar konnten nicht geladen werden.</RegionLoadError>
      )}
    </>
  );
}
