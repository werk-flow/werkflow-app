import { z } from '../zod';

// The reviewed security posture of a Supabase project's Auth configuration and
// the reviewed exceptions to its database advisors. `bun run auth:check` and
// `bun run advisors:check` (scripts/check-supabase-project.ts) read DEV through
// the Management API and fail on any difference. Change an entry only together
// with the project setting, and say why in the reason.

type AuthExpectation = { value: boolean | number; reason: string };

export const AUTH_POSTURE: Record<string, AuthExpectation> = {
  disable_signup: {
    value: false,
    reason: 'An owner signs up to create an organization, and an invited person signs up to join one.',
  },
  external_anonymous_users_enabled: { value: false, reason: 'Every caller is a confirmed person.' },
  mailer_autoconfirm: {
    value: false,
    reason: 'A new account proves its mailbox with the emailed code before it signs in.',
  },
  mailer_allow_unverified_email_sign_ins: { value: false, reason: 'An unconfirmed mailbox never signs in.' },
  mailer_secure_email_change_enabled: {
    value: true,
    reason: 'An email change needs confirmation from both mailboxes.',
  },
  mailer_otp_exp: { value: 300, reason: 'A sign-up or recovery code expires after five minutes.' },
  mailer_otp_length: { value: 6, reason: 'The code forms accept exactly six digits.' },
  password_min_length: { value: 8, reason: 'The password forms require eight characters.' },
  password_hibp_enabled: { value: true, reason: 'Auth refuses passwords that appear in known breaches.' },
  refresh_token_rotation_enabled: {
    value: true,
    reason: 'A refresh token works once, so a stolen one is detected.',
  },
  security_refresh_token_reuse_interval: {
    value: 10,
    reason: 'Parallel tabs may reuse a refresh token for ten seconds, no longer.',
  },
  security_update_password_require_reauthentication: {
    value: true,
    reason: 'A password change in a signed-in session needs a fresh code.',
  },
  security_manual_linking_enabled: { value: false, reason: 'Identities are never linked by the client.' },
  jwt_exp: { value: 3600, reason: 'An access token lives one hour; the revocation boundaries rely on it.' },
  rate_limit_email_sent: { value: 25, reason: 'Auth mail per hour, matched to the mail provider.' },
  rate_limit_verify: { value: 30, reason: 'Code and link verifications per five minutes and address.' },
  rate_limit_otp: { value: 30, reason: 'Code requests per five minutes and address.' },
  rate_limit_token_refresh: { value: 150, reason: 'Token refreshes per five minutes and address.' },
  saml_enabled: { value: false, reason: 'No enterprise single sign-on exists.' },
  oauth_server_enabled: { value: false, reason: 'The project is no OAuth provider for other apps.' },
  custom_oauth_enabled: { value: false, reason: 'No custom identity provider exists.' },
  sms_autoconfirm: { value: false, reason: 'No phone identity exists.' },
};

/** Sign-in methods and Auth hooks that may be on. Every other `external_*_enabled` and `hook_*_enabled` key must be false. */
export const ENABLED_AUTH_SWITCHES: Record<string, string> = {
  external_email_enabled: 'Email with password and code is the only sign-in method.',
};

const SWITCH_KEY = /^(?:external|hook)_.+_enabled$/;

function display(value: unknown): string {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

function isAllowedRedirect(entry: string): boolean {
  // The host, up to the first slash, carries no glob character; a path wildcard is allowed.
  return /^https:\/\/[^/*?[\]]+(?:\/|$)/.test(entry) || /^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(entry);
}

/**
 * Every difference between a project's Auth configuration and the reviewed
 * posture. It names the reviewed keys only, whose values are no secrets.
 */
export function authConfigProblems(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [key, expectation] of Object.entries(AUTH_POSTURE)) {
    if (config[key] !== expectation.value)
      problems.push(`${key}: expected ${display(expectation.value)}, found ${display(config[key])}.`);
  }
  for (const [key, value] of Object.entries(config)) {
    if (!SWITCH_KEY.test(key)) continue;
    const allowed = key in ENABLED_AUTH_SWITCHES;
    if (value === true && !allowed) problems.push(`${key}: is on, but no reviewed entry allows it.`);
    if (value !== true && allowed) problems.push(`${key}: the reviewed sign-in method is off.`);
  }
  for (const key of Object.keys(ENABLED_AUTH_SWITCHES)) {
    if (!(key in config)) problems.push(`${key}: missing from the Auth configuration.`);
  }
  const redirects = [
    config.site_url,
    ...(typeof config.uri_allow_list === 'string' ? config.uri_allow_list.split(',') : []),
  ];
  for (const entry of redirects) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    if (!isAllowedRedirect(entry.trim()))
      problems.push(`redirect ${entry.trim()}: must be an https origin or localhost, never a wildcard host.`);
  }
  return problems;
}

const advisorLintSchema = z.object({
  name: z.string(),
  level: z.enum(['ERROR', 'WARN', 'INFO']),
  categories: z.array(z.string()),
  detail: z.string(),
  cache_key: z.string(),
});
export const advisorResponseSchema = z.object({ lints: z.array(advisorLintSchema) });
type AdvisorLint = z.infer<typeof advisorLintSchema>;

/** INFO lints of the security advisor that the design produces on purpose. */
const ACCEPTED_SECURITY_INFO_LINTS: Record<string, string> = {
  rls_enabled_no_policy:
    'Server-only tables enable RLS without a policy, so client roles reach no row (docs/technical/security.md, "Add a table" step 2).',
};

/** Reviewed WARN or ERROR findings, by cache key. The check fails on an entry the advisor no longer reports. */
export const ADVISOR_EXCEPTIONS: Record<string, string> = {
  multiple_permissive_policies_public_inventory_movements_authenticated_SELECT:
    'Two access paths: the assigned field worker and the inventory manager. Merging them into one policy rewrites the RLS of a table that stays small per organization.',
  multiple_permissive_policies_public_job_material_lines_authenticated_SELECT:
    'Two access paths: the assigned field worker and the inventory manager, as for inventory_movements.',
  multiple_permissive_policies_public_organization_join_requests_authenticated_SELECT:
    'Two access paths: the requester reads their own request, approvers read the organization queue.',
  multiple_permissive_policies_public_profiles_authenticated_SELECT:
    'Two access paths: a user reads their own profile before any membership exists, members read co-member profiles.',
};

function needsReview(lint: AdvisorLint): boolean {
  if (lint.level !== 'INFO') return true;
  return lint.categories.includes('SECURITY') && !(lint.name in ACCEPTED_SECURITY_INFO_LINTS);
}

/** Advisor findings that no reviewed entry covers, and reviewed entries the advisor no longer reports. */
export function advisorProblems(
  lints: readonly AdvisorLint[],
  exceptions: Record<string, string> = ADVISOR_EXCEPTIONS,
): string[] {
  const problems: string[] = [];
  const reported = new Set(lints.map((lint) => lint.cache_key));
  for (const lint of lints) {
    if (!needsReview(lint) || lint.cache_key in exceptions) continue;
    problems.push(`${lint.level} ${lint.name}: ${lint.detail.replaceAll('\\`', '`')} (${lint.cache_key})`);
  }
  for (const key of Object.keys(exceptions)) {
    if (!reported.has(key))
      problems.push(`stale advisor exception ${key}: the advisor no longer reports it.`);
  }
  return problems;
}
