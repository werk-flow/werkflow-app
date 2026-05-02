'use client';

import Link from 'next/link';

interface EntityLinkCardProps {
  title: string;
  href: string;
  icon: React.ReactNode;
  metadata?: { label: string; value: string }[];
  badge?: React.ReactNode;
  emptyState?: { text: string; action?: React.ReactNode };
  onEmptyClick?: () => void;
}

export function EntityLinkCard({
  title,
  href,
  icon,
  metadata,
  badge,
  emptyState,
  onEmptyClick,
}: EntityLinkCardProps) {
  const isEmpty = !href && emptyState;

  if (isEmpty) {
    const isClickable = !!onEmptyClick;
    return (
      <button
        type="button"
        className={`w-full rounded-lg border border-dashed bg-card p-4 text-left ${
          isClickable
            ? 'cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/30'
            : ''
        }`}
        onClick={onEmptyClick}
        disabled={!isClickable}
      >
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <span className="text-muted-foreground">{emptyState!.text}</span>
          {emptyState!.action}
        </div>
      </button>
    );
  }

  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/30"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{title}</span>
            {badge}
          </div>
          {metadata && metadata.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {metadata.map((m) => (
                <p
                  key={m.label}
                  className="truncate text-xs text-muted-foreground"
                >
                  {m.label}: {m.value}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
