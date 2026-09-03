import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface PageBreadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  /** Area name above the title on subpages ("Zeiterfassung" over "Zeitkonto"). */
  eyebrow?: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  /** Route-level subnavigation (`AreaNav`); rendered on the header's bottom edge. */
  nav?: ReactNode;
  /** Detail pages: the first crumb is the back target. */
  breadcrumbs?: PageBreadcrumb[];
}

/**
 * The one page header: sticky inside the page column, one title style, one
 * padding. Area headers put `AreaNav` in `nav`; detail pages pass
 * `breadcrumbs`; in-page state tabs never live here (design canon).
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  badges,
  actions,
  nav,
  breadcrumbs,
}: PageHeaderProps) {
  const backHref = breadcrumbs?.[0]?.href;

  return (
    <header
      data-page-header=""
      className="sticky top-0 z-10 shrink-0 border-b bg-background px-4 pt-3 sm:px-6 sm:pt-4"
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Pfad"
          className="mb-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground"
        >
          {backHref ? (
            <Link
              href={backHref}
              className="flex shrink-0 items-center gap-1 transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">{breadcrumbs[0]?.label}</span>
            </Link>
          ) : (
            <span className="shrink-0">{breadcrumbs[0]?.label}</span>
          )}
          {breadcrumbs.slice(1).map((crumb, index) => (
            <span key={index} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="size-3.5 shrink-0" />
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="truncate transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-foreground">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className={nav ? 'pb-2' : 'pb-3 sm:pb-4'}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {eyebrow}
              </p>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-xl font-bold sm:text-2xl">{title}</h1>
              {badges}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      </div>

      {nav}
    </header>
  );
}
