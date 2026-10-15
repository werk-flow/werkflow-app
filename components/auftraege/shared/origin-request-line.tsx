import { RegionLoadError } from '@/components/shared/region-load-error';
import { TextLink } from '@/components/ui/text-link';

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
      <TextLink href={originRequest.href} className="font-medium">
        {originRequest.label}
      </TextLink>
    </p>
  );
}
