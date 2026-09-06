import { ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList, SkeletonTable } from "@/components/ui/skeleton-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TimePeriodDetail } from "@/lib/time-accounts/actions";
import { formatMinutes } from "@/lib/time-accounts/presentation";
import { TIME_PERIOD_RESULT_COLUMNS } from "./time-period-result-columns";

/** All result fields remain available on phones, without a scrolling table. */
export function TimePeriodResults({
  results,
}: Pick<TimePeriodDetail, "results">): React.JSX.Element {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {results.map((result) => (
          <ListRow key={result.employeeRecordId} className="block space-y-2">
            <p className="font-medium">{result.employeeName}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Soll</dt>
              <dd className="text-right tabular-nums">
                {formatMinutes(result.targetMinutes)}
              </dd>
              <dt className="text-muted-foreground">Gewertet</dt>
              <dd className="text-right tabular-nums">
                {formatMinutes(result.creditedMinutes)}
              </dd>
              <dt className="text-muted-foreground">Differenz</dt>
              <dd className="text-right tabular-nums">
                {formatMinutes(result.periodDeltaMinutes)}
              </dd>
              <dt className="text-muted-foreground">Schlusssaldo</dt>
              <dd className="text-right tabular-nums">
                {formatMinutes(result.closingBalanceMinutes)}
              </dd>
              <dt className="text-muted-foreground">Sollquelle</dt>
              <dd className="text-right">
                {result.authoritativeTargets ? "Arbeitsplan" : "Ersatzwert"}
              </dd>
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
                <TableCell className="font-medium">
                  {result.employeeName}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatMinutes(result.targetMinutes)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatMinutes(result.creditedMinutes)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatMinutes(result.periodDeltaMinutes)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatMinutes(result.closingBalanceMinutes)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {result.authoritativeTargets ? "Arbeitsplan" : "Ersatzwert"}
                </TableCell>
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
                <span className="text-sm text-muted-foreground">
                  {column.header}
                </span>
                <span className="justify-self-end">{column.skeleton}</span>
              </div>
            ))}
          </div>
        </div>
      </SkeletonList>
      <SkeletonTable
        columns={TIME_PERIOD_RESULT_COLUMNS}
        rows={5}
        className="hidden bg-card md:block"
      />
    </>
  );
}
