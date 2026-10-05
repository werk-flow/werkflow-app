import { translateSupabasePasswordError } from '../../../lib/validation/password';

/** The German message the product shows when HaveIBeenPwned rejects a password. */
export const LEAKED_PASSWORD_MESSAGE = translateSupabasePasswordError(
  'Password is known to be weak and easy to guess, please choose a different one',
);
