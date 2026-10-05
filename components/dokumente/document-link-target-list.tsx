'use client';

import { type ReactElement } from 'react';
import { Check, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PlainButton } from '@/components/ui/plain-button';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { cn } from '@/lib/utils';
import type { JobEntityOptionsState } from '@/hooks/use-job-entity-options';

type DocumentLinkTargetListProps = {
  listError: string | undefined;
  onRetryList: () => void;
  isLoadingList: boolean;
  visibleTargets: JobEntityOption[];
  selectedIds: Set<string>;
  linkedIds: string[];
  onToggle: (option: JobEntityOption) => void;
  ActiveIcon: LucideIcon;
  noun: string | undefined;
  activeSearch: JobEntityOptionsState | null;
};

export function DocumentLinkTargetList({
  listError,
  onRetryList,
  isLoadingList,
  visibleTargets,
  selectedIds,
  linkedIds,
  onToggle,
  ActiveIcon,
  noun,
  activeSearch,
}: DocumentLinkTargetListProps): ReactElement {
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      {listError ? (
        <SectionError className="m-3" onRetry={onRetryList} retryPending={isLoadingList}>
          {listError}
        </SectionError>
      ) : isLoadingList ? (
        <div className="divide-y" role="status" aria-busy="true">
          <span className="sr-only">Einträge werden geladen.</span>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleTargets.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          Keine passenden Einträge gefunden.
        </div>
      ) : (
        <div className="divide-y">
          {visibleTargets.map((target) => {
            const isSelected = selectedIds.has(target.value);
            const wasLinked = linkedIds.includes(target.value);
            return (
              <PlainButton
                key={target.value}
                type="button"
                onClick={() => onToggle(target)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                  isSelected && 'bg-accent',
                )}
              >
                <ActiveIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{target.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {isSelected
                      ? wasLinked
                        ? 'Verknüpft'
                        : 'Neu ausgewählt'
                      : wasLinked
                        ? 'Wird entfernt'
                        : noun}
                  </span>
                </span>
                {isSelected && (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3.5" />
                  </span>
                )}
              </PlainButton>
            );
          })}
          {activeSearch?.onLoadMore && (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-muted-foreground">
              <span>Es gibt weitere Einträge. Suche gezielt oder lade mehr.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={activeSearch.onLoadMore}
                disabled={activeSearch.loading}
              >
                Mehr laden
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
