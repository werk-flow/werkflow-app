import { CheckCircle2 } from 'lucide-react';

import { type PasswordChangeStep } from '@/components/settings/use-password-change-flow';
import { cn } from '@/lib/utils';

export function PasswordStepIndicator({ currentStep }: { currentStep: PasswordChangeStep }) {
  const steps = [
    {
      key: 'verify_current',
      label: 'Aktuelles Passwort',
      description: 'Zur Bestätigung deines Kontos',
    },
    {
      key: 'set_new',
      label: 'Neues Passwort',
      description: 'Sicheres Passwort festlegen',
    },
  ] as const;

  return (
    <div className="flex gap-4 lg:w-52 lg:flex-col">
      {steps.map((step, index) => {
        const isActive = currentStep === step.key;
        const isComplete = step.key === 'verify_current' && currentStep === 'set_new';

        return (
          <div key={step.key} className="flex flex-1 items-start gap-3 lg:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  isComplete
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-primary bg-primary/10 text-primary-text'
                      : 'border-border bg-background text-muted-foreground',
                )}
              >
                {isComplete ? <CheckCircle2 className="size-4" /> : index + 1}
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={cn(
                    'mt-2 h-10 w-px rounded-full lg:h-12',
                    isComplete ? 'bg-primary/60' : 'bg-border',
                  )}
                />
              ) : null}
            </div>
            <div className="pt-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  isActive || isComplete ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
