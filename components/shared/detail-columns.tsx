import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The column layouts of the detail pages, by the width of the page content
 * (a `detail` size container), never by the screen: the app sidebar takes
 * 256 px, so a screen breakpoint turned columns on where they did not fit
 * (the service case and equipment details showed a 380 px main column at
 * 1024 px, UI audit of 2026-10-15). A detail page and its loading skeleton
 * name the same layout, so the skeleton switches where the page switches
 * (`lib/ui/detail-columns.test.ts`). Column tracks are `minmax(0, …)`, so a
 * long name cannot widen them, and the grid breaks a long word anywhere, so
 * it cannot stick out of its card either. A table keeps normal wrapping.
 */
const DETAIL_COLUMN_LAYOUTS = {
  /** Two equal columns from a 56rem content width: the job detail. */
  halves: 'gap-6 @4xl/detail:grid-cols-2',
  /** Facts beside a wider work column from 56rem: the project detail. */
  'facts-and-work': 'gap-6 @4xl/detail:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]',
  /** Cards beside a wide history table from 80rem: the customer and member details. */
  'cards-and-table': 'gap-6 @7xl/detail:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]',
  /** A main column beside a 20rem side column from 56rem: the service case. */
  'main-and-aside': 'gap-6 @4xl/detail:grid-cols-[minmax(0,1fr)_20rem]',
  /** A main column beside a side column of at least 18rem from 56rem: the installed equipment. */
  'main-and-wide-aside': 'gap-6 @4xl/detail:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]',
  /** Two fact cards side by side from 48rem: the request. */
  pair: 'gap-4 @3xl/detail:grid-cols-2',
  /** A card grid, two from 48rem and three from 80rem: the personnel record. */
  cards: 'gap-6 @3xl/detail:grid-cols-2 @7xl/detail:grid-cols-3',
} as const;

export type DetailColumnLayout = keyof typeof DETAIL_COLUMN_LAYOUTS;

/** The `detail` size container and the column grid of a detail page or its skeleton. */
export function DetailColumns({ layout, children }: { layout: DetailColumnLayout; children: ReactNode }) {
  return (
    <div className="@container/detail">
      <div className={cn('grid grid-cols-1 wrap-anywhere', DETAIL_COLUMN_LAYOUTS[layout])}>{children}</div>
    </div>
  );
}
