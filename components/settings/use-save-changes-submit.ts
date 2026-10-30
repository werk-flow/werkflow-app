'use client';

import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { useBanner } from '@/components/ui/banner';
import { NOTHING_TO_SAVE } from '@/lib/settings/save-answers';

/**
 * The submit handler of a settings form: it validates, then saves only a
 * changed form and answers an unchanged one with NOTHING_TO_SAVE. `isDirty`
 * is read here during render, because react-hook-form tracks only the form
 * state a render subscribed to.
 */
export function useSaveChangesSubmit<TFieldValues extends FieldValues, TContext, TTransformedValues>(
  form: UseFormReturn<TFieldValues, TContext, TTransformedValues>,
  save: (values: TTransformedValues) => Promise<void>,
): ReturnType<UseFormReturn<TFieldValues, TContext, TTransformedValues>['handleSubmit']> {
  const { showBanner } = useBanner();
  const { isDirty } = form.formState;
  return form.handleSubmit(async (values) => {
    if (!isDirty) {
      showBanner(NOTHING_TO_SAVE);
      return;
    }
    await save(values);
  });
}
