import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { FileText } from "lucide-react";

import { ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const CONTEXTUAL_DOCUMENTS_EMPHASIZE_UPLOAD = true;

export const CONTEXTUAL_DOCUMENT_LIST_CLASS =
  "min-w-0 overflow-hidden rounded-md border";

type ContextualDocumentsFrameProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> & {
  title: string;
  description: string;
  actions?: ReactNode;
};

/** Shared responsive shell for resolved documents and their loading state. */
export function ContextualDocumentsFrame({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: ContextualDocumentsFrameProps): ReactElement {
  return (
    <div
      data-slot="contextual-documents-frame"
      className={cn(
        "min-w-0 rounded-lg border bg-card p-4 transition-colors sm:p-5",
        className,
      )}
      {...props}
    >
      <div
        data-slot="contextual-documents-header"
        className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="size-4" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {actions && (
          <div
            data-slot="contextual-documents-actions"
            className="flex shrink-0 flex-wrap gap-2"
          >
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** The row has separate open/menu controls; its surrounding box is inert. */
export function ContextualDocumentRowFrame({
  children,
  indented = false,
  skeleton = false,
}: {
  children: ReactNode;
  indented?: boolean;
  skeleton?: boolean;
}): ReactElement {
  return (
    <ListRow
      variant="plain"
      skeleton={skeleton}
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 px-3 py-2.5",
        indented && "pl-8",
      )}
    >
      {children}
    </ListRow>
  );
}

export function ContextualDocumentsSkeleton({
  title = "Dokumente & Bilder",
  description,
  canUpload = false,
  canAttach = false,
  emphasizeUpload = CONTEXTUAL_DOCUMENTS_EMPHASIZE_UPLOAD,
}: {
  title?: string;
  description: string;
  canUpload?: boolean;
  canAttach?: boolean;
  emphasizeUpload?: boolean;
}): ReactElement {
  return (
    <ContextualDocumentsFrame
      title={title}
      description={description}
      role="status"
      aria-label="Dokumente werden geladen"
      aria-busy="true"
      actions={
        canUpload ? (
          <>
            {canAttach && <Skeleton className="h-8 w-28" />}
            <Skeleton
              className={cn("w-28", emphasizeUpload ? "h-8" : "h-11")}
            />
          </>
        ) : undefined
      }
    >
      <span className="sr-only">Dokumente werden geladen.</span>
      <div className={CONTEXTUAL_DOCUMENT_LIST_CLASS}>
        {Array.from({ length: 2 }, (_, index) => (
          <ContextualDocumentRowFrame key={index} skeleton>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton className="h-5 w-2/3" />
              </div>
              <Skeleton className="ml-6 mt-0.5 h-4 w-1/2" />
            </div>
            <Skeleton className="size-8 shrink-0" />
          </ContextualDocumentRowFrame>
        ))}
      </div>
    </ContextualDocumentsFrame>
  );
}
