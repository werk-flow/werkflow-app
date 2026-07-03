import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { type PasswordRequirementFlags } from '@/lib/validation/password';

const REQUIREMENT_ITEMS: Array<{
  key: keyof PasswordRequirementFlags;
  label: string;
}> = [
  { key: 'length', label: 'Mindestens 8 Zeichen' },
  { key: 'uppercase', label: 'Mindestens ein Großbuchstabe' },
  { key: 'lowercase', label: 'Mindestens ein Kleinbuchstabe' },
  { key: 'number', label: 'Mindestens eine Zahl' }
];

type PasswordRequirementsProps = {
  requirements: PasswordRequirementFlags;
  className?: string;
};

export function PasswordRequirements({
  requirements,
  className
}: PasswordRequirementsProps) {
  return (
    <ul
      aria-live="polite"
      className={cn('space-y-1 text-sm', className)}
      role="list"
    >
      {REQUIREMENT_ITEMS.map((item) => {
        const met = requirements[item.key];
        return (
          <li
            key={item.key}
            className="flex items-center gap-2"
            role="listitem"
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors',
                met
                  ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                  : 'border-destructive/30 bg-destructive/10 text-destructive'
              )}
            >
              {met ? (
                <Check aria-hidden className="h-3 w-3 [stroke-width:3]" />
              ) : (
                <X aria-hidden className="h-3 w-3 [stroke-width:3]" />
              )}
            </span>
            <span
              className={cn(
                'leading-tight transition-colors',
                met ? 'text-emerald-700' : 'text-muted-foreground'
              )}
            >
              {item.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}











