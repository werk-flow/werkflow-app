'use client';

import { MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { type DerivedProjectStatus, type Project, PROJECT_STATUS_LABELS } from '@/lib/jobs/types';
import { PROJECT_STATUS_CLASSES } from '../status-classes';
import { TrafficLight } from './project-detail-status';

type ProjectDetailHeaderProps = {
  liveProject: Project;
  liveDerivedStatus: DerivedProjectStatus;
  isAdminOrManager: boolean;
  setShowCreateJob: (open: boolean) => void;
  setShowEditDialog: (open: boolean) => void;
  setShowDeleteDialog: (open: boolean) => void;
};

export function ProjectDetailHeader({
  liveProject,
  liveDerivedStatus,
  isAdminOrManager,
  setShowCreateJob,
  setShowEditDialog,
  setShowDeleteDialog,
}: ProjectDetailHeaderProps) {
  return (
    <DetailPageHeader
      breadcrumbs={[
        { label: 'Aufträge', href: '/auftraege' },
        { label: liveProject.projectNumber ?? 'Projekt' },
      ]}
      title={liveProject.name}
      badges={
        <>
          <Badge variant="secondary" className={PROJECT_STATUS_CLASSES[liveDerivedStatus.status]}>
            {PROJECT_STATUS_LABELS[liveDerivedStatus.status]}
          </Badge>
          <TrafficLight status={liveDerivedStatus.trafficLight} />
        </>
      }
      actions={
        isAdminOrManager ? (
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreateJob(true)}>
              <Plus className="size-3.5" />
              <span className="sr-only sm:not-sr-only">Auftrag hinzufügen</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="Aktionen öffnen">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                  <Pencil className="mr-2 size-4" />
                  Bearbeiten
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="mr-2 size-4" />
                  Projekt löschen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : undefined
      }
    />
  );
}
