'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type ReactElement } from 'react';

import { SectionError } from '@/components/ui/section-error';

export function FieldWorkPackLoadError({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <SectionError
      title={title}
      onRetry={() => startTransition(() => router.refresh())}
      retryPending={pending}
    >
      {description}
    </SectionError>
  );
}
