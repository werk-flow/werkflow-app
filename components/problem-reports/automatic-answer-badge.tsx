import { Badge } from '@/components/ui/badge';

/** Marks an answer a report thread wrote, so the reporter and support can tell it from a person's. */
export function AutomaticAnswerBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={className}>
      Automatisch geschrieben
    </Badge>
  );
}
