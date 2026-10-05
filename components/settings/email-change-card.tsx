'use client';

import { EmailChangeStepIndicator } from '@/components/settings/email-change-step-indicator';
import {
  CurrentEmailPanel,
  EmailChangeCompletedNotice,
  EmailChangeCompletionPendingNotice,
} from '@/components/settings/email-change-status-panels';
import {
  EnterNewEmailStep,
  VerifyCurrentEmailStep,
  VerifyNewEmailStep,
} from '@/components/settings/email-change-steps';
import { useEmailChangeWizard } from '@/components/settings/use-email-change-wizard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';

type EmailChangeCardProps = {
  initialState: EmailChangeWizardState;
};

export function EmailChangeCard({ initialState }: EmailChangeCardProps) {
  const wizard = useEmailChangeWizard(initialState);
  const { wizardState, completionState, formError } = wizard;

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-Mail-Adresse</CardTitle>
        <CardDescription>
          Verifiziere zuerst deine aktuelle Adresse, hinterlege danach die neue E-Mail-Adresse und bestätige
          sie mit einem zweiten Code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 break-words">
        {wizardState.step === 'completion_pending' ? (
          <EmailChangeCompletionPendingNotice wizardState={wizardState} />
        ) : completionState ? (
          <EmailChangeCompletedNotice
            completionState={completionState}
            onDismiss={wizard.dismissCompletion}
          />
        ) : null}

        <CurrentEmailPanel
          currentEmail={wizard.currentEmail}
          step={wizardState.step}
          isStarting={wizard.isStarting}
          onStart={wizard.handleStartFlow}
        />

        {wizardState.step !== 'idle' && wizardState.step !== 'completion_pending' ? (
          <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <EmailChangeStepIndicator currentStep={wizardState.step} isComplete={completionState !== null} />

            <div className="space-y-5 rounded-lg border bg-background p-5">
              <ErrorText>{formError}</ErrorText>

              {wizardState.step === 'verify_current' ? <VerifyCurrentEmailStep wizard={wizard} /> : null}

              {wizardState.step === 'enter_new' ? <EnterNewEmailStep wizard={wizard} /> : null}

              {wizardState.step === 'verify_new' ? <VerifyNewEmailStep wizard={wizard} /> : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
