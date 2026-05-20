export const AUTH_FLASH_COOKIE = 'auth_flash';

export const AUTH_FLASH_MESSAGES = {
  passwordResetRequested:
    'Wenn eine E-Mail existiert, haben wir dir einen Link geschickt.',
  passwordResetRequestedKnownUser:
    'Wir haben dir einen Link zum Zurücksetzen deines Passworts geschickt. Bitte prüfe dein E-Mail-Postfach.',
  passwordResetSuccess:
    'Passwort erfolgreich aktualisiert. Bitte erneut einloggen.',
} as const;

export type AuthFlashKey =
  | 'password-reset-requested'
  | 'password-reset-requested-known-user'
  | 'password-reset-success';

export function isAuthFlashKey(value: unknown): value is AuthFlashKey {
  return (
    value === 'password-reset-requested' ||
    value === 'password-reset-requested-known-user' ||
    value === 'password-reset-success'
  );
}

export function getAuthFlashMessage(key: AuthFlashKey): string {
  switch (key) {
    case 'password-reset-requested':
      return AUTH_FLASH_MESSAGES.passwordResetRequested;
    case 'password-reset-requested-known-user':
      return AUTH_FLASH_MESSAGES.passwordResetRequestedKnownUser;
    case 'password-reset-success':
      return AUTH_FLASH_MESSAGES.passwordResetSuccess;
    default: {
      const exhaustiveKey: never = key;
      throw new Error(`Unhandled auth flash key: ${exhaustiveKey}`);
    }
  }
}
