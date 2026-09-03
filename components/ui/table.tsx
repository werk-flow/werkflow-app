import * as React from "react"

import { cn } from "@/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

// Hover is opt-in (design canon, 2026-09-03): a row hovers only when a click
// does something. `interactive` navigates or acts on click; `"select"` is the
// Dokumente flavor where click selects and double-click opens (the `group`
// reveals the selection circle). Skeleton rows pass the same value, so a
// loading placeholder can never promise more or less than the loaded row.
export type TableRowInteractive = boolean | "select"

export const TABLE_ROW_INTERACTIVE_CLASS =
  "cursor-pointer transition-colors hover:bg-accent/50"
export const TABLE_ROW_SELECT_CLASS =
  "group cursor-default transition-colors hover:bg-accent/50"

export function tableRowClassName(
  interactive: TableRowInteractive | undefined,
  className?: string
): string {
  return cn(
    "border-b data-[state=selected]:bg-muted",
    interactive === true && TABLE_ROW_INTERACTIVE_CLASS,
    interactive === "select" && TABLE_ROW_SELECT_CLASS,
    className
  )
}

type TableRowProps = React.HTMLAttributes<HTMLTableRowElement> & {
  interactive?: TableRowInteractive
  /** Loading placeholder row: same classes as the loaded row, hidden from assistive tech. */
  skeleton?: boolean
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, interactive, skeleton, ...props }, ref) => (
    <tr
      ref={ref}
      data-skeleton={skeleton ? "" : undefined}
      aria-hidden={skeleton ? true : undefined}
      className={tableRowClassName(interactive, className)}
      {...props}
    />
  )
)
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}



