'use client';

import { Check, Download, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { OwnPersonnelActions } from '@/lib/personnel/lifecycle-actions';
import { REQUIREMENT_STATE_LABELS } from '@/lib/personnel/lifecycle';

type PersonnelOwnRequirementListProps = {
  requirements: OwnPersonnelActions['requirements'];
  isBusy: (id: string) => boolean;
  onAcknowledge: (requirementId: string, requirementVersion: number) => Promise<void>;
};

export function PersonnelOwnRequirementList({
  requirements,
  isBusy,
  onAcknowledge,
}: PersonnelOwnRequirementListProps) {
  return (
    <ul className="divide-y rounded-md border">
      {requirements.map((requirement) => (
        <li key={requirement.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{requirement.title}</p>
            <p className="text-xs text-muted-foreground">
              {requirement.blockerReason ??
                requirement.description ??
                (requirement.isRequired ? 'Erforderlich' : 'Optional')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={requirement.state === 'blocked' ? 'destructive' : 'secondary'}>
              {REQUIREMENT_STATE_LABELS[requirement.state]}
            </Badge>
            {requirement.requirementType === 'acknowledgement' &&
            (requirement.state === 'missing' || requirement.state === 'pending') ? (
              <Button
                size="sm"
                onClick={() => void onAcknowledge(requirement.id, requirement.version)}
                disabled={isBusy(requirement.id)}
              >
                {isBusy(requirement.id) ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}{' '}
                Bestätigen
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

type PersonnelOwnDocumentListProps = {
  documents: OwnPersonnelActions['documents'];
  isBusy: (id: string) => boolean;
  onDownload: (rowId: string, documentId: string) => Promise<void>;
  onAcknowledge: (personnelDocumentId: string, version: number) => Promise<void>;
};

export function PersonnelOwnDocumentList({
  documents,
  isBusy,
  onDownload,
  onAcknowledge,
}: PersonnelOwnDocumentListProps) {
  return (
    <ul className="divide-y rounded-md border">
      {documents.map((document) => (
        <li key={document.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{document.displayName}</p>
            <p className="text-xs text-muted-foreground">
              {document.documentType} · Version {document.currentVersionNumber}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onDownload(document.id, document.documentId)}
              disabled={isBusy(document.id)}
            >
              {isBusy(document.id) ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}{' '}
              Öffnen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onAcknowledge(document.id, document.currentVersionNumber)}
              disabled={isBusy(document.id)}
            >
              {isBusy(document.id) ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}{' '}
              Erhalt bestätigen
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
