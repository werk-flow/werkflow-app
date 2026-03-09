'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface DetailPageHeaderProps {
  breadcrumbs: Breadcrumb[];
  title: React.ReactNode;
  subtitle?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}

export function DetailPageHeader({
  breadcrumbs,
  title,
  subtitle,
  badges,
  actions,
}: DetailPageHeaderProps) {
  const backHref = breadcrumbs[0]?.href ?? '/auftraege';

  return (
    <div className="sticky top-0 z-10 border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
      <nav className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href={backHref}
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">{breadcrumbs[0]?.label}</span>
        </Link>
        {breadcrumbs.slice(1).map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5" />
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-foreground">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-bold sm:text-2xl">{title}</h1>
            {badges}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
