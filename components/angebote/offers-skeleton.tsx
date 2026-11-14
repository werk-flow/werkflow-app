'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonTable } from '@/components/ui/skeleton-table';
import { OFFER_COLUMNS } from './offers-columns';

// Content-only skeletons: the Angebote layout keeps the h1 and the area nav on screen.

/** The facts the offer header lists, one placeholder row each. */
const OFFER_FACTS = [
  'Kunde',
  'Einsatzort',
  'Ansprechpartner',
  'Rechnungsempfänger',
  'Gültig bis',
  'Verantwortlich',
  'Einleitung',
  'Schluss',
] as const;

/** Toolbar, count and rows. Loaded rows open their offer, so skeleton rows hover too. */
export function OffersListSkeleton() {
  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-full sm:w-48" />
          <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
            <Skeleton className="h-8 min-w-0 flex-1 sm:max-w-xs" />
            <Skeleton className="size-8" />
          </div>
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <SkeletonList interactive className="md:hidden" />
      <SkeletonTable columns={OFFER_COLUMNS} interactive className="hidden md:block" />
    </>
  );
}

export function OffersPageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Angebote werden geladen">
      <span className="sr-only">Angebote werden geladen.</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <OffersListSkeleton />
    </div>
  );
}

/** The offer's page: its title line and the header's stacked facts. */
export function OfferDetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Angebot wird geladen">
      <span className="sr-only">Angebot wird geladen.</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-72 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
        <Skeleton className="h-4 w-32" />
        {OFFER_FACTS.map((fact) => (
          <div key={fact} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
