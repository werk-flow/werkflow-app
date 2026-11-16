import { z } from '@/lib/zod';

import type { BreakPolicyValues, BreakStep, OrgBreakMode } from './settings';

// The break rule as the settings form and its save edit it. Its own module,
// apart from lib/time-tracking/settings.ts: the week views load settings.ts on
// the client, and this schema with its German messages stays out of their
// bundle (lab counts).

/**
 * The second step a new organization starts with and an existing one is
 * offered: beyond nine hours, 45 minutes in total (ArbZG § 4).
 */
const DEFAULT_SECOND_BREAK_STEP: BreakStep = { thresholdMinutes: 540, durationMinutes: 45 };

export const BREAK_MODE_OPTIONS: Array<{
  value: OrgBreakMode;
  label: string;
  description: string;
}> = [
  {
    value: 'manual',
    label: 'Pause manuell stempeln',
    description: 'Mitarbeiter starten und beenden ihre Pausen weiterhin selbst per Pause-Button.',
  },
  {
    value: 'automatic',
    label: 'Pause automatisch abziehen',
    description:
      'Sobald die konfigurierte Arbeitszeit erreicht ist, wird die feste Pausenzeit automatisch abgezogen.',
  },
];

export const timeTrackingSettingsSchema = z
  .object({
    breakMode: z.enum(['manual', 'automatic']),
    autoBreakThresholdMinutes: z.coerce.number().int().min(1).max(1440),
    autoBreakDurationMinutes: z.coerce.number().int().min(0).max(1440),
    secondStepEnabled: z.boolean(),
    // Checked only while the step is on: a switched-off step keeps whatever its fields hold.
    secondStepThresholdMinutes: z.coerce.number().int().min(0),
    secondStepDurationMinutes: z.coerce.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    if (value.autoBreakDurationMinutes > value.autoBreakThresholdMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['autoBreakDurationMinutes'],
        message: 'Die Pause darf nicht länger als die Schwelle sein.',
      });
    }
    if (!value.secondStepEnabled) return;
    if (value.secondStepThresholdMinutes > 1440) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepThresholdMinutes'],
        message: 'Die zweite Schwelle darf höchstens 1440 Minuten betragen.',
      });
    } else if (value.secondStepThresholdMinutes <= value.autoBreakThresholdMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepThresholdMinutes'],
        message: 'Die zweite Schwelle muss nach der ersten liegen.',
      });
    } else if (value.secondStepDurationMinutes < value.autoBreakDurationMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepDurationMinutes'],
        message: 'Die Pause der zweiten Stufe ist die Gesamtpause und darf nicht kürzer als die erste sein.',
      });
    } else if (
      value.secondStepDurationMinutes - value.autoBreakDurationMinutes >
      value.secondStepThresholdMinutes - value.autoBreakThresholdMinutes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondStepDurationMinutes'],
        message: 'Die zusätzliche Pause passt nicht zwischen die beiden Schwellen.',
      });
    }
  });

export type TimeTrackingSettingsValues = z.infer<typeof timeTrackingSettingsSchema>;

/** The rule's values as the settings form edits them; a switched-off second step offers the defaults. */
export function breakPolicyFormValues(policy: BreakPolicyValues): TimeTrackingSettingsValues {
  const secondStep = policy.secondStep ?? DEFAULT_SECOND_BREAK_STEP;
  return {
    breakMode: policy.breakMode,
    autoBreakThresholdMinutes: policy.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: policy.autoBreakDurationMinutes,
    secondStepEnabled: policy.secondStep !== null,
    secondStepThresholdMinutes: secondStep.thresholdMinutes,
    secondStepDurationMinutes: secondStep.durationMinutes,
  };
}

/** The rule a saved form describes. */
export function breakPolicyValuesOf(values: TimeTrackingSettingsValues): BreakPolicyValues {
  return {
    breakMode: values.breakMode,
    autoBreakThresholdMinutes: values.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: values.autoBreakDurationMinutes,
    secondStep: values.secondStepEnabled
      ? {
          thresholdMinutes: values.secondStepThresholdMinutes,
          durationMinutes: values.secondStepDurationMinutes,
        }
      : null,
  };
}
