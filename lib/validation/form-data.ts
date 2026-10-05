import { z } from '@/lib/zod';

/**
 * Boundary check for a Server Action that receives a form. The schema names
 * every field the action reads with its type and bound (ids as `uuidSchema`,
 * bounded text); unknown fields are ignored. Returns the same FormData when
 * every field passes, so the action keeps reading it with `formData.get`, and
 * null otherwise. A field sent twice is refused: the action reads one value.
 */
export function parseFormData(formData: unknown, schema: z.ZodType): FormData | null {
  if (!(formData instanceof FormData)) return null;
  // No prototype: a field named `constructor` or `__proto__` is an ordinary field, not an inherited key.
  const fields: Record<string, FormDataEntryValue> = Object.create(null);
  for (const [key, value] of formData.entries()) {
    if (Object.hasOwn(fields, key)) return null;
    fields[key] = value;
  }
  return schema.safeParse(fields).success ? formData : null;
}

/** An optional text field of at most `maxLength` characters. */
export function optionalFormText(maxLength: number): z.ZodOptional<z.ZodString> {
  return z.string().max(maxLength).optional();
}
