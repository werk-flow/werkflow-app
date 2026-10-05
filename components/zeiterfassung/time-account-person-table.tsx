'use client';

import type { ReactNode } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** `row` renders inside the table from the tablet breakpoint, `card` is the phone card. */
export type PersonLayout = 'row' | 'card';

// Per-person forms of the time rules page are a table with one header row from
// the tablet breakpoint and one card per person on phones (owner decision
// 2026-10-03). A table row cannot hold a form, so each person's form sits in
// the name cell and the other cells' controls join it through the `form`
// attribute.

/** One person: a table row (with an error row below it) or a phone card. */
export function PersonRow({
  layout,
  name,
  form,
  cells,
  error,
}: {
  layout: PersonLayout;
  name: ReactNode;
  /** The person's `<form id>`; the controls in `cells` name that id in their `form` attribute. */
  form: ReactNode;
  cells: Array<{ key: string; content: ReactNode }>;
  error: string | null;
}) {
  if (layout === 'card') {
    return (
      <ListRow className="block space-y-3">
        <div className="font-medium">{name}</div>
        {form}
        {cells.map((cell) => (
          <div key={cell.key}>{cell.content}</div>
        ))}
        <ErrorText>{error}</ErrorText>
      </ListRow>
    );
  }
  return (
    <>
      <TableRow>
        <TableCell className="font-medium">
          {name}
          {form}
        </TableCell>
        {cells.map((cell) => (
          <TableCell key={cell.key}>{cell.content}</TableCell>
        ))}
      </TableRow>
      {error && (
        <TableRow>
          <TableCell colSpan={cells.length + 1} className="pt-0">
            <ErrorText>{error}</ErrorText>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** The phone cards and the desktop table of one per-person section. */
export function PersonTable({
  heads,
  renderPeople,
}: {
  heads: Array<{ label: string; className?: string }>;
  renderPeople: (layout: PersonLayout) => ReactNode;
}) {
  return (
    <>
      <div className="space-y-2 md:hidden">{renderPeople('card')}</div>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {heads.map((head) => (
                <TableHead key={head.label} className={head.className}>
                  {head.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>{renderPeople('row')}</TableBody>
        </Table>
      </div>
    </>
  );
}
