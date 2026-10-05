'use client';

import type { ReactElement, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Every settings subpage is a stack of cards (title, description, a field
// grid, an optional footer with the save button). The skeletons below are
// built from the same Card parts, so padding and gaps cannot drift.

function SettingsCardSkeleton({
  fieldCount = 0,
  columns = 2,
  footer = false,
  children,
}: {
  fieldCount?: number;
  columns?: 1 | 2;
  footer?: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-4 w-full max-w-md" />
      </CardHeader>
      <CardContent className={columns === 2 ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-4'}>
        {Array.from({ length: fieldCount }).map((_, index) => (
          <div key={index} className="grid gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        {children}
      </CardContent>
      {footer && (
        <CardFooter className="justify-end border-t">
          <Skeleton className="h-9 w-40" />
        </CardFooter>
      )}
    </Card>
  );
}

function TextLinesSkeleton({ lines }: { lines: number }): ReactElement {
  return (
    <div className="space-y-2 sm:col-span-2">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="h-4 w-full max-w-2xl" />
      ))}
    </div>
  );
}

function CheckboxListSkeleton({ rows }: { rows: number }): ReactElement {
  return (
    <div className="space-y-3 sm:col-span-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-40" />
        </div>
      ))}
    </div>
  );
}

const PLACEHOLDER_SECTION = (
  <>
    <SettingsCardSkeleton>
      <TextLinesSkeleton lines={4} />
    </SettingsCardSkeleton>
    <SettingsCardSkeleton>
      <TextLinesSkeleton lines={2} />
    </SettingsCardSkeleton>
  </>
);

/** One entry per settings route; `lib/conventions/route-loading.test.ts` requires a loading file per page. */
const SECTION_SKELETONS = {
  profil: (
    <>
      <SettingsCardSkeleton columns={1}>
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="h-9 w-36" />
        </div>
      </SettingsCardSkeleton>
      <SettingsCardSkeleton fieldCount={2} footer />
    </>
  ),
  'konto-sicherheit': (
    <>
      <SettingsCardSkeleton columns={1}>
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-9 w-48" />
      </SettingsCardSkeleton>
      <SettingsCardSkeleton columns={1}>
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-9 w-44" />
      </SettingsCardSkeleton>
    </>
  ),
  'abonnement-abrechnung': PLACEHOLDER_SECTION,
  organisation: (
    <>
      <SettingsCardSkeleton>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-32" />
          </div>
        ))}
      </SettingsCardSkeleton>
      <SettingsCardSkeleton fieldCount={2} columns={1} footer />
      <SettingsCardSkeleton columns={1}>
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="h-8 w-full" />
      </SettingsCardSkeleton>
    </>
  ),
  mitarbeiter: (
    <>
      <div className="space-y-4 border-b pb-5">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <SettingsCardSkeleton>
        <TextLinesSkeleton lines={2} />
      </SettingsCardSkeleton>
      <SettingsCardSkeleton footer>
        <TextLinesSkeleton lines={3} />
      </SettingsCardSkeleton>
      <SettingsCardSkeleton footer>
        <TextLinesSkeleton lines={3} />
      </SettingsCardSkeleton>
    </>
  ),
  'auftraege-projekte': (
    <SettingsCardSkeleton footer>
      <CheckboxListSkeleton rows={8} />
    </SettingsCardSkeleton>
  ),
  kunden: PLACEHOLDER_SECTION,
  kalender: PLACEHOLDER_SECTION,
  dashboard: PLACEHOLDER_SECTION,
  zeiterfassung: (
    <>
      <SettingsCardSkeleton footer>
        <div className="grid gap-1.5 sm:col-span-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-full" />
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="grid gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </SettingsCardSkeleton>
      <SettingsCardSkeleton fieldCount={1} footer />
      <SettingsCardSkeleton>
        <TextLinesSkeleton lines={3} />
      </SettingsCardSkeleton>
      <SettingsCardSkeleton columns={1}>
        <Skeleton className="h-9 w-52" />
      </SettingsCardSkeleton>
    </>
  ),
} as const satisfies Record<string, ReactElement>;

type SettingsSkeletonSlug = keyof typeof SECTION_SKELETONS;

function isSettingsSkeletonSlug(slug: string): slug is SettingsSkeletonSlug {
  return Object.hasOwn(SECTION_SKELETONS, slug);
}

/** Content skeleton of one settings subpage; rendered inside the settings shell. */
export function SettingsSectionSkeleton({ slug }: { slug: SettingsSkeletonSlug }): ReactElement {
  return <div className="space-y-6">{SECTION_SKELETONS[slug]}</div>;
}

/** The section skeleton of the current route, for boundaries that sit above the subpage (layout guard, org switch). */
export function EinstellungenContentSkeleton(): ReactElement {
  const slug = usePathname().split('/').filter(Boolean)[1] ?? '';
  return <SettingsSectionSkeleton slug={isSettingsSkeletonSlug(slug) ? slug : 'profil'} />;
}

/** Org-switch overlay: mirrors `SettingsShell` (area header, `w-72` section nav from `md`, subpage heading). */
export function EinstellungenPageSkeleton(): ReactElement {
  return (
    <PageShell className="bg-background">
      <PageHeader
        title="Einstellungen"
        nav={
          <div className="md:pb-2">
            <div className="flex h-9 items-center gap-1 md:hidden">
              <Skeleton className="mx-3 h-4 w-14" />
              <Skeleton className="mx-3 h-4 w-32" />
              <Skeleton className="mx-3 h-4 w-28" />
            </div>
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-72 shrink-0 border-r bg-card/40 p-4 md:block">
          <div className="space-y-1">
            <Skeleton className="mb-2 h-4 w-24" />
            {Array.from({ length: 9 }).map((_, index) => (
              <Skeleton key={index} className="h-13 w-full rounded-lg" />
            ))}
          </div>
        </aside>
        <PageBody>
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-6 space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-full max-w-lg" />
            </div>
            <EinstellungenContentSkeleton />
          </div>
        </PageBody>
      </div>
    </PageShell>
  );
}
