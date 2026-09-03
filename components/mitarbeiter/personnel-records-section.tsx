'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ContactRound } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AccessStateBadge,
  EmploymentStateBadge,
} from '@/components/mitarbeiter/personnel-state-badges';
import {
  EMPLOYMENT_TYPE_LABELS,
  formatEmployeeRecordName,
  getAccessState,
  getEmploymentState,
} from '@/lib/personnel/types';
import type { PersonnelListEntry } from '@/lib/personnel/actions';

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

interface PersonnelRecordsSectionProps {
  entries: PersonnelListEntry[];
  // Names of linked users resolved from profiles (record id -> display name).
  profileNames: Record<string, string>;
}

/**
 * Personnel records that are not active members: future starters and personnel
 * without app access, plus exited people whose membership was removed. Active
 * members stay in the members table above.
 */
export function PersonnelRecordsSection({
  entries,
  profileNames,
}: PersonnelRecordsSectionProps) {
  const router = useRouter();

  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => {
    const stateOrder = { geplant: 0, aktiv: 1, ausgeschieden: 2 } as const;
    const stateA = getEmploymentState(a.record);
    const stateB = getEmploymentState(b.record);
    if (stateOrder[stateA] !== stateOrder[stateB]) {
      return stateOrder[stateA] - stateOrder[stateB];
    }
    return formatEmployeeRecordName(a.record, profileNames[a.record.id]).localeCompare(
      formatEmployeeRecordName(b.record, profileNames[b.record.id]),
      'de'
    );
  });

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <ContactRound className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Weiteres Personal
        </h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Zukünftige und ehemalige Mitarbeiter sowie Personal ohne App-Zugang.
      </p>

      {/* Mobile view - card list */}
      <div className="space-y-2 md:hidden">
        {sorted.map(({ record, hasPendingInvite }) => {
          const name = formatEmployeeRecordName(record, profileNames[record.id]);
          return (
            // A real link so keyboard, middle-click, and copy-link work.
            <ListRow key={record.id} asChild interactive>
              <Link
                href={`/mitarbeiter/${record.id}`}
                aria-label={`Personalakte öffnen: ${name}`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{name}</p>
                    {record.employeeNumber && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {record.employeeNumber}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EmploymentStateBadge state={getEmploymentState(record)} />
                    <AccessStateBadge
                      state={getAccessState(record, hasPendingInvite)}
                    />
                  </div>
                  {record.entryDate && (
                    <p className="text-xs text-muted-foreground">
                      Eintritt: {formatDate(record.entryDate)}
                    </p>
                  )}
                </div>
              </Link>
            </ListRow>
          );
        })}
      </div>

      {/* Desktop view - table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[22%]">Name</TableHead>
              <TableHead className="w-[130px]">Personalnummer</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[140px]">Zugang</TableHead>
              <TableHead className="w-[160px]">Beschäftigungsart</TableHead>
              <TableHead className="w-[120px]">Eintritt</TableHead>
              <TableHead className="w-[120px]">Austritt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(({ record, hasPendingInvite, currentCondition }) => {
              const name = formatEmployeeRecordName(
                record,
                profileNames[record.id]
              );
              return (
                <TableRow
                  key={record.id}
                  interactive
                  onClick={() => router.push(`/mitarbeiter/${record.id}`)}
                >
                  <TableCell className="max-w-0">
                    {/* Real link inside the clickable row for keyboard users,
                        middle-click, and Cmd+Click. */}
                    <Link
                      href={`/mitarbeiter/${record.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.employeeNumber || '—'}
                  </TableCell>
                  <TableCell>
                    <EmploymentStateBadge state={getEmploymentState(record)} />
                  </TableCell>
                  <TableCell>
                    <AccessStateBadge
                      state={getAccessState(record, hasPendingInvite)}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {currentCondition
                      ? EMPLOYMENT_TYPE_LABELS[currentCondition.employmentType]
                      : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.entryDate ? formatDate(record.entryDate) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.exitDate ? formatDate(record.exitDate) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
