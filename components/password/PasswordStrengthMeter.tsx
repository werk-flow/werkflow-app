import { cn } from '@/lib/utils';

const STRENGTH_LABELS = [
  'Sehr schwach',
  'Schwach',
  'Ausreichend',
  'Gut',
  'Sehr stark'
] as const;

// Semantic tokens only (werkflow-design): the weak end reads red, the middle
// yellow, the strong end green; no functional colour literal in JSX.
const FILL_CLASSES = ['bg-destructive', 'bg-warning', 'bg-warning', 'bg-success', 'bg-success'] as const;

type PasswordStrengthMeterProps = {
  level: number;
  className?: string;
};

export function PasswordStrengthMeter({
  level,
  className
}: PasswordStrengthMeterProps) {
  const clampedLevel = Math.max(0, Math.min(4, Math.round(level)));
  const label = STRENGTH_LABELS[clampedLevel];
  const percent = Math.min(100, Math.max(0, (clampedLevel / 4) * 100));
  const fillClass = FILL_CLASSES[clampedLevel];

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
        <span>Passwortstärke</span>
        <span>{label}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          aria-label="Passwortstärke"
          aria-valuemax={4}
          aria-valuemin={0}
          aria-valuenow={clampedLevel}
          aria-valuetext={label}
          className={cn('h-full rounded-full transition-all duration-500 ease-in-out', fillClass)}
          role="meter"
          style={{
            width: `${percent}%`,
            transitionProperty: 'width, background-color'
          }}
        />
      </div>
    </div>
  );
}
