import { z } from '@/lib/zod';

/** Trimmed text, or null when the value is missing or blank. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Optional form text: a blank string is null; any other value is trimmed and bounded. */
export function nullableTrimmedText(
  minimum: number,
  maximum: number,
): z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodNullable<z.ZodOptional<z.ZodString>>> {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().min(minimum).max(maximum).optional().nullable(),
  );
}

/** A string bounded to `maximum` characters at the boundary; the value rules stay with the caller. */
export function boundedText(maximum: number): z.ZodString {
  return z.string().max(maximum);
}

/** `boundedText` that also accepts null or a missing value, for patch inputs. */
export function nullableBoundedText(maximum: number): z.ZodOptional<z.ZodNullable<z.ZodString>> {
  return boundedText(maximum).nullable().optional();
}
