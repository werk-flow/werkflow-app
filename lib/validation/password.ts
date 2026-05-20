import { z } from 'zod';

const MIN_PASSWORD_LENGTH = 8;
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /[0-9]/;

export const passwordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`
  )
  .regex(
    UPPERCASE_REGEX,
    'Das Passwort braucht mindestens einen Großbuchstaben.'
  )
  .regex(
    LOWERCASE_REGEX,
    'Das Passwort braucht mindestens einen Kleinbuchstaben.'
  )
  .regex(NUMBER_REGEX, 'Das Passwort braucht mindestens eine Zahl.');

export const passwordWithConfirmationSchema = z.object({
  password: passwordSchema,
  confirmPassword: z.string().min(1, 'Bitte bestätige dein neues Passwort.'),
});

export type PasswordWithConfirmationValues = z.infer<
  typeof passwordWithConfirmationSchema
>;

export type PasswordRequirementFlags = {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  allMet: boolean;
};

export function getPasswordRequirements(
  password: string
): PasswordRequirementFlags {
  const length = password.length >= MIN_PASSWORD_LENGTH;
  const uppercase = UPPERCASE_REGEX.test(password);
  const lowercase = LOWERCASE_REGEX.test(password);
  const number = NUMBER_REGEX.test(password);

  return {
    length,
    uppercase,
    lowercase,
    number,
    allMet: length && uppercase && lowercase && number
  };
}

export function getPasswordStrengthLevel(password: string): number {
  if (!password) {
    return 0;
  }

  const { length, uppercase, lowercase, number } =
    getPasswordRequirements(password);
  const baseScore =
    Number(length) + Number(uppercase) + Number(lowercase) + Number(number);

  const bonus = password.length >= 16 ? 1 : password.length >= 12 ? 0.5 : 0;
  const score = Math.min(4, Math.round(baseScore + bonus));

  return Math.max(0, score);
}

export function getPasswordConfirmationError(
  values: PasswordWithConfirmationValues
) {
  if (!values.confirmPassword) {
    return 'Bitte bestätige dein neues Passwort.';
  }

  if (values.password !== values.confirmPassword) {
    return 'Die Passwörter stimmen nicht überein.';
  }

  return null;
}

export function translateSupabasePasswordError(error: unknown): string {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';

  if (!message) {
    return 'Das Passwort erfüllt nicht die Anforderungen. Bitte prüfe die Kriterien und versuche es erneut.';
  }

  const normalized = message.toLowerCase();

  // Check for "same password" error - when user tries to reuse their old password
  if (
    normalized.includes('different from') ||
    normalized.includes('same as') ||
    normalized.includes('cannot be the same') ||
    normalized.includes('should be different') ||
    normalized.includes('must be different') ||
    normalized.includes('new password should be different') ||
    normalized.includes('password has been used') ||
    normalized.includes('old password') ||
    normalized.includes('reuse') ||
    normalized.includes('previously used')
  ) {
    return 'Das neue Passwort muss sich vom alten Passwort unterscheiden.';
  }

  if (
    normalized.includes('least 8') ||
    normalized.includes('shorter than 8') ||
    normalized.includes('longer than 8') ||
    normalized.includes('minimum length of 8')
  ) {
    return `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`;
  }

  if (normalized.includes('uppercase')) {
    return 'Das Passwort muss mindestens einen Großbuchstaben enthalten.';
  }

  if (normalized.includes('lowercase')) {
    return 'Das Passwort muss mindestens einen Kleinbuchstaben enthalten.';
  }

  if (normalized.includes('number') || normalized.includes('numeric')) {
    return 'Das Passwort muss mindestens eine Zahl enthalten.';
  }

  if (
    normalized.includes('password') &&
    (normalized.includes('weak') ||
      normalized.includes('insecure') ||
      normalized.includes('rejected') ||
      normalized.includes('invalid'))
  ) {
    return 'Das Passwort erfüllt nicht die Anforderungen. Bitte prüfe die Kriterien und versuche es erneut.';
  }

  return 'Das Passwort erfüllt nicht die Anforderungen. Bitte prüfe die Kriterien und versuche es erneut.';
}
