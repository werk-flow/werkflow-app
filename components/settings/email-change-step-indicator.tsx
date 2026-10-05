import { CheckCircle2 } from 'lucide-react';

import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';
import { cn } from '@/lib/utils';

export function EmailChangeStepIndicator({
  currentStep,
  isComplete,
}: {
  currentStep: EmailChangeWizardState['step'];
  isComplete: boolean;
}) {
  const steps = [
    {
      key: 'verify_current',
      label: 'Aktuelle E-Mail bestätigen',
      description: 'Code an die aktuelle Adresse',
    },
    {
      key: 'enter_new',
      label: 'Neue E-Mail eingeben',
      description: 'Neue Adresse für das Konto',
    },
    {
      key: 'verify_new',
      label: 'Neue E-Mail bestätigen',
      description: 'Code aus dem neuen Postfach',
    },
  ] as const;

  return (
    <div className="flex gap-4 lg:w-52 lg:flex-col">
      {steps.map((step, index) => {
        const isActive = !isComplete && currentStep === step.key;
        const isStepComplete =
          isComplete ||
          (step.key === 'verify_current' && (currentStep === 'enter_new' || currentStep === 'verify_new')) ||
          (step.key === 'enter_new' && currentStep === 'verify_new');

        return (
          <div key={step.key} className="flex flex-1 items-start gap-3 lg:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  isStepComplete
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-primary bg-primary/10 text-primary-text'
                      : 'border-border bg-background text-muted-foreground',
                )}
              >
                {isStepComplete ? <CheckCircle2 className="size-4" /> : index + 1}
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={cn(
                    'mt-2 h-10 w-px rounded-full lg:h-12',
                    isStepComplete ? 'bg-primary/60' : 'bg-border',
                  )}
                />
              ) : null}
            </div>
            <div className="pt-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  isActive || isStepComplete ? 'text-foreground' : 'text-muted-foreground',
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
