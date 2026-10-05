import Link from 'next/link';

import { RegionLoadError } from '@/components/shared/region-load-error';

/** The Anfrage a job or project came from; 'failed' when its read failed, null when there is none. */
export type OriginRequestLink = { label: string; href: string } | 'failed' | null;

/** „Entstanden aus …“ above a job or project, or the failed read with a retry. */
export function OriginRequestLine({ originRequest }: { originRequest: OriginRequestLink | undefined }) {
  if (!originRequest) return null;
  if (originRequest === 'failed') {
    return (
      <RegionLoadError className="mb-4">
        Die Anfrage, aus der das entstanden ist, konnte nicht geladen werden.
      </RegionLoadError>
    );
  }
  return (
    <p className="mb-4 text-sm text-muted-foreground">
      Entstanden aus{' '}
      <Link
        href={originRequest.href}
        className="font-medium text-primary-text underline-offset-4 hover:underline"
      >
        {originRequest.label}
      </Link>
    </p>
  );
}
