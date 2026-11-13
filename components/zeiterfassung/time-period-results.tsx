import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonTable } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PeriodResultRow, PeriodResultValues } from '@/lib/time-accounts/period-results';
import { FINDING_LABELS, formatMinutes } from '@/lib/time-accounts/presentation';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { TIME_PERIOD_RESULT_COLUMNS } from './time-period-result-columns';

const VALUE_TERMS: ReadonlyArray<{ key: keyof PeriodResultValues; term: string }> = [
  { key: 'targetMinutes', term: 'Soll' },
  { key: 'creditedMinutes', term: 'Gewertet' },
  { key: 'periodDeltaMinutes', term: 'Differenz' },
  { key: 'closingBalanceMinutes', term: 'Schlusssaldo' },
];

/** One value of the month, or „—“ while the person could not be calculated: not computed is not zero. */
function ResultValue({ result, valueKey }: { result: PeriodResultRow; valueKey: keyof PeriodResultValues }) {
  if (result.outcome.computed) return <>{formatMinutes(result.outcome[valueKey])}</>;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">nicht berechnet</span>
    </>
  );
}

/** Why a person's month has no values: the setup gaps the findings below name. */
function UncomputedCause({ result }: { result: PeriodResultRow }) {
  if (result.outcome.computed) return null;
  return (
    <span className="block text-sm text-muted-foreground">
      Nicht berechnet: {result.outcome.causes.map((cause) => FINDING_LABELS[cause]).join(' · ')}
    </span>
  );
}

/** Why a Soll is lower: the Berufsschule days, each credited with its normal target. */
function SchoolNote({ result }: { result: PeriodResultRow }) {
  if (result.schoolMinutes === 0) return null;
  return (
    <span className="block text-sm text-muted-foreground">
      Berufsschule: {formatDuration(result.schoolMinutes)} als Tagesziel angerechnet
    </span>
  );
}

function targetSourceLabel(result: PeriodResultRow): string {
  return result.authoritativeTargets ? 'Arbeitsplan' : 'Ersatzwert';
}

/** All result fields remain available on phones, without a scrolling table. */
export function TimePeriodResults({ results }: { results: readonly PeriodResultRow[] }): React.JSX.Element {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {results.map((result) => (
          <ListRow key={result.employeeRecordId} className="block space-y-2">
            <div>
              <p className="break-words font-medium">{result.employeeName}</p>
              <UncomputedCause result={result} />
              <SchoolNote result={result} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {VALUE_TERMS.map(({ key, term }) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="text-right tabular-nums">
                    <ResultValue result={result} valueKey={key} />
                  </dd>
                </div>
              ))}
              <dt className="text-muted-foreground">Sollquelle</dt>
              <dd className="text-right">{targetSourceLabel(result)}</dd>
            </dl>
          </ListRow>
        ))}
      </div>
      <div className="hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {TIME_PERIOD_RESULT_COLUMNS.map((column) => (
                <TableHead key={column.id} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((result) => (
              <TableRow key={result.employeeRecordId}>
                <TableCell>
                  <span className="block font-medium">{result.employeeName}</span>
                  <UncomputedCause result={result} />
                  <SchoolNote result={result} />
                </TableCell>
                {VALUE_TERMS.map(({ key }) => (
                  <TableCell key={key} className="tabular-nums">
                    <ResultValue result={result} valueKey={key} />
                  </TableCell>
                ))}
                <TableCell className="text-muted-foreground">{targetSourceLabel(result)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function TimePeriodResultsSkeleton(): React.JSX.Element {
  return (
    <>
      <SkeletonList count={5} className="md:hidden">
        <div className="w-full space-y-2">
          <Skeleton className="h-4 w-36" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {TIME_PERIOD_RESULT_COLUMNS.slice(1).map((column) => (
              <div key={column.id} className="contents">
                <span className="text-sm text-muted-foreground">{column.header}</span>
                <span className="justify-self-end">{column.skeleton}</span>
              </div>
            ))}
          </div>
        </div>
      </SkeletonList>
      <SkeletonTable columns={TIME_PERIOD_RESULT_COLUMNS} rows={5} className="hidden bg-card md:block" />
    </>
  );
}
