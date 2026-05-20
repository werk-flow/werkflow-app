import { z } from 'zod';

export const ORGANIZATION_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ORGANIZATION_CODE_LENGTH = 6;
export const ORGANIZATION_CODE_REGEX = new RegExp(
  `^[${ORGANIZATION_CODE_CHARSET}]{${ORGANIZATION_CODE_LENGTH}}$`
);

export function normalizeOrganizationName(name: string): string {
  return name.trim();
}

export function normalizeOrganizationCode(code: string): string {
  return code.trim().toUpperCase();
}

export function getOrganizationNameValidationError(
  name: string
): 'name_required' | 'name_too_short' | 'name_too_long' | null {
  const normalizedName = normalizeOrganizationName(name);

  if (!normalizedName) {
    return 'name_required';
  }

  if (normalizedName.length < 2) {
    return 'name_too_short';
  }

  if (normalizedName.length > 100) {
    return 'name_too_long';
  }

  return null;
}

export function getOrganizationCodeValidationError(
  code: string
): 'code_required' | 'code_invalid' | null {
  const normalizedCode = normalizeOrganizationCode(code);

  if (!normalizedCode) {
    return 'code_required';
  }

  if (!ORGANIZATION_CODE_REGEX.test(normalizedCode)) {
    return 'code_invalid';
  }

  return null;
}

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Bitte gib einen Namen mit mindestens 2 Zeichen ein.').max(100, 'Der Name darf maximal 100 Zeichen lang sein.'),
  uniqueCode: z
    .string()
    .transform(normalizeOrganizationCode)
    .refine((value) => value.length > 0, 'Bitte gib einen Organisationscode ein.')
    .refine(
      (value) => ORGANIZATION_CODE_REGEX.test(value),
      `Der Organisationscode muss genau ${ORGANIZATION_CODE_LENGTH} Zeichen lang sein und darf nur Großbuchstaben sowie Zahlen enthalten.`
    ),
});

export type OrganizationSettingsValues = z.infer<typeof organizationSettingsSchema>;
