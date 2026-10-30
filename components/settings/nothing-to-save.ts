'use client';

import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { type BannerVariant, useBanner } from '@/components/ui/banner';

/**
 * The answer to a settings save pressed without a change. The save button
 * stays enabled (werkflow-design: Forms and Enter), so the press says why
 * nothing happened instead of sending an empty write.
 */
export const NOTHING_TO_SAVE: { variant: BannerVariant; message: string } = {
  variant: 'info',
  message: 'Es gibt keine Änderungen zu speichern.',
};

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
