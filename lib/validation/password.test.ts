import { describe, expect, test } from 'bun:test';

import { translateSupabasePasswordError } from './password';

describe('translateSupabasePasswordError', () => {
  test('maps the leaked-password (HIBP) rejection to the dedicated German message', () => {
    // GoTrue's message when password_hibp_enabled rejects a breached password.
    const result = translateSupabasePasswordError({
      message:
        'Password is known to be weak and easy to guess, please choose a different one'
    });
    expect(result).toBe(
      'Dieses Passwort ist aus Datenlecks bekannt und daher unsicher. Bitte wähle ein anderes Passwort.'
    );
  });

  test('leaked-password phrasing wins over the generic weak branch', () => {
    const result = translateSupabasePasswordError({
      message: 'Password is known to be weak'
    });
    expect(result).toContain('Datenlecks');
  });

  test('maps the same-password rejection', () => {
    const result = translateSupabasePasswordError({
      message: 'New password should be different from the old password'
    });
    expect(result).toBe(
      'Das neue Passwort muss sich vom alten Passwort unterscheiden.'
    );
  });

  test('maps the minimum-length rejection', () => {
    const result = translateSupabasePasswordError({
      message: 'Password should be at least 8 characters'
    });
    expect(result).toBe('Das Passwort muss mindestens 8 Zeichen lang sein.');
  });

  test('falls back to the generic German message for unknown password errors', () => {
    const result = translateSupabasePasswordError({
      message: 'Password is invalid'
    });
    expect(result).toBe(
      'Das Passwort erfüllt nicht die Anforderungen. Bitte prüfe die Kriterien und versuche es erneut.'
    );
  });
});
