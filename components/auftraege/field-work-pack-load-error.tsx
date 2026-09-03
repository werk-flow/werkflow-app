'use client';

import type { ReactElement } from 'react';

import { useRouterRefresh } from '@/components/ui/refresh-button';
import { SectionError } from '@/components/ui/section-error';

export function FieldWorkPackLoadError({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement {
  const { refresh, isPending } = useRouterRefresh();
  return (
    <SectionError title={title} onRetry={refresh} retryPending={isPending}>
      {description}
    </SectionError>
  );
}
