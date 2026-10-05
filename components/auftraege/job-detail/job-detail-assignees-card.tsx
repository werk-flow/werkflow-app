'use client';

import Link from 'next/link';
import { Users, UserPlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import type { JobAssignmentWithProfile } from '@/lib/jobs/types';
import { PersonAvatar, getSessionPersonName } from './job-detail-person';
import { SectionTitle } from '@/components/shared/section-title';

type JobDetailAssigneesCardProps = {
  assignments: JobAssignmentWithProfile[];
  isAdminOrManager: boolean;
  openAssignDialog: () => void;
  isUnassigning: (userId: string) => boolean;
  handleUnassign: (userId: string) => Promise<void>;
};

export function JobDetailAssigneesCard({
  assignments,
  isAdminOrManager,
  openAssignDialog,
  isUnassigning,
  handleUnassign,
}: JobDetailAssigneesCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icon={<Users className="size-4" />}>Zugewiesene Mitarbeiter</SectionTitle>
        {isAdminOrManager && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={openAssignDialog}>
            <UserPlus className="size-3" />
            Zuweisen
          </Button>
        )}
      </div>
      {assignments.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">Keine Mitarbeiter zugewiesen.</p>
      ) : (
        <div className="divide-y">
          {assignments.map((a) => (
            <div key={a.userId} className="flex items-center gap-3 py-2">
              <PersonAvatar
                person={a}
                className="size-8"
                fallbackClassName="bg-primary/10 text-xs font-medium text-primary-text"
              />
              <div className="min-w-0 flex-1">
                <Link href={`/mitarbeiter/${a.userId}`} className="text-sm font-medium hover:underline">
                  {getSessionPersonName(a)}
                </Link>
                {a.email && <p className="truncate text-xs text-muted-foreground">{a.email}</p>}
              </div>
              {isAdminOrManager && (
                <>
                  <InlinePending active={isUnassigning(a.userId)} label="Zuweisung wird entfernt" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    aria-label={`Zuweisung für ${getSessionPersonName(a)} entfernen`}
                    onClick={() => handleUnassign(a.userId)}
                    disabled={isUnassigning(a.userId)}
                  >
                    <X className="size-3" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
