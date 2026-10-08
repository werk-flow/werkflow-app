import { describe, expect, test } from 'bun:test';

import {
  ADVISOR_EXCEPTIONS,
  AUTH_POSTURE,
  ENABLED_AUTH_SWITCHES,
  advisorProblems,
  authConfigProblems,
} from './supabase-project-checks';

function reviewedConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {
    site_url: 'https://app.example.test',
    uri_allow_list: 'http://localhost:3000,https://preview.example.test/**',
    external_google_enabled: false,
    hook_send_email_enabled: false,
  };
  for (const [key, expectation] of Object.entries(AUTH_POSTURE)) config[key] = expectation.value;
  for (const key of Object.keys(ENABLED_AUTH_SWITCHES)) config[key] = true;
  return config;
}

function lint(name: string, level: 'ERROR' | 'WARN' | 'INFO', categories: string[], cacheKey: string) {
  return {
    name,
    level,
    categories,
    detail: 'Table \\`public.' + cacheKey + '\\` probe',
    cache_key: cacheKey,
  };
}

const reviewedLints = Object.keys(ADVISOR_EXCEPTIONS).map((key) =>
  lint('multiple_permissive_policies', 'WARN', ['PERFORMANCE'], key),
);

describe('Auth configuration posture', () => {
  test('the reviewed posture passes', () => {
    expect(authConfigProblems(reviewedConfig())).toEqual([]);
  });

  test('a weakened setting fails and names the key', () => {
    const config = { ...reviewedConfig(), mailer_autoconfirm: true, password_min_length: 6 };
    expect(authConfigProblems(config)).toEqual([
      'mailer_autoconfirm: expected false, found true.',
      'password_min_length: expected 8, found 6.',
    ]);
  });

  test('a missing reviewed key fails instead of passing silently', () => {
    const config = reviewedConfig();
    delete config.jwt_exp;
    expect(authConfigProblems(config)).toEqual(['jwt_exp: expected 3600, found missing.']);
  });

  test('a new sign-in method or hook fails until a reviewed entry allows it', () => {
    const config = { ...reviewedConfig(), external_google_enabled: true, hook_send_email_enabled: true };
    expect(authConfigProblems(config)).toEqual([
      'external_google_enabled: is on, but no reviewed entry allows it.',
      'hook_send_email_enabled: is on, but no reviewed entry allows it.',
    ]);
  });

  test('a redirect to a wildcard host or plain http fails', () => {
    const config = {
      ...reviewedConfig(),
      uri_allow_list: 'https://*.example.test,https://app-*.example.test,http://example.test',
    };
    expect(authConfigProblems(config)).toEqual([
      'redirect https://*.example.test: must be an https origin or localhost, never a wildcard host.',
      'redirect https://app-*.example.test: must be an https origin or localhost, never a wildcard host.',
      'redirect http://example.test: must be an https origin or localhost, never a wildcard host.',
    ]);
  });

  test('a secret value never reaches a problem message', () => {
    const config = { ...reviewedConfig(), smtp_pass: 'probe-secret-value', jwt_exp: 7200 };
    expect(authConfigProblems(config).join('\n')).not.toContain('probe-secret-value');
  });
});

describe('Supabase advisors', () => {
  test('reviewed exceptions and accepted INFO lints pass', () => {
    const lints = [
      ...reviewedLints,
      lint('rls_enabled_no_policy', 'INFO', ['SECURITY'], 'rls_enabled_no_policy_public_probe'),
      lint('unused_index', 'INFO', ['PERFORMANCE'], 'unused_index_public_probe'),
    ];
    expect(advisorProblems(lints)).toEqual([]);
  });

  test('an unreviewed WARN or ERROR fails with its detail', () => {
    const lints = [
      ...reviewedLints,
      lint('duplicate_index', 'WARN', ['PERFORMANCE'], 'duplicate_index_probe'),
    ];
    expect(advisorProblems(lints)).toEqual([
      'WARN duplicate_index: Table `public.duplicate_index_probe` probe (duplicate_index_probe)',
    ]);
  });

  test('a security INFO lint outside the accepted names fails', () => {
    const lints = [...reviewedLints, lint('auth_users_exposed', 'INFO', ['SECURITY'], 'auth_users_probe')];
    expect(advisorProblems(lints)).toHaveLength(1);
  });

  test('an exception the advisor no longer reports fails as stale', () => {
    expect(advisorProblems(reviewedLints.slice(1))).toEqual([
      `stale advisor exception ${reviewedLints[0]?.cache_key}: the advisor no longer reports it.`,
    ]);
  });
});
