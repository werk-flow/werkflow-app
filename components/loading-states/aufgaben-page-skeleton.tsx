'use client';

import { AufgabenListSkeleton } from '@/components/aufgaben/aufgaben-content';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';

function AufgabenContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      {/* The own personnel actions section stays empty for most people; it reserves no space. */}
      <AufgabenListSkeleton />
    </div>
  );
}

export function AufgabenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Aufgaben" />
      <PageBody>
        <AufgabenContentSkeleton />
      </PageBody>
    </PageShell>
  );
}
