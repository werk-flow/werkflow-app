'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';

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
    <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5" role="alert">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ErrorText className="mt-2">{description}</ErrorText>
      <Button
        type="button"
        variant="outline"
        className="mt-3 min-h-11"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Erneut laden
      </Button>
    </section>
  );
}
