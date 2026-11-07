'use client';

import { Lock } from 'lucide-react';

import type { DocumentArchive } from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import { getArchiveLabel } from './document-library-file-labels';

/** A library row's archive line: the filed state and the retention end, when there is one. */
export function DocumentArchiveLabel({
  archive,
  className,
}: {
  archive: DocumentArchive | null;
  className?: string;
}) {
  const label = getArchiveLabel(archive);
  if (!label) return null;
  return (
    <p className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}>
      {archive?.filedAt ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
    </p>
  );
}
