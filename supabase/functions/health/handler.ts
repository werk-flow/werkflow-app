import { createMailAuthorizer } from '../_shared/mail-auth.ts';
import { sha256Hex, timingSafeEquals } from '../_shared/secret-compare.ts';

// The weekly health workflow reads this function (.github/workflows/health.yml)
// with the HEALTH_CHECK_TOKEN header. verify_jwt is off (the deploy steps' --no-verify-jwt),
// so this guard is the only one: without the token the function answers like
// the gateway answers for a function that does not exist. The report names
// each check and its state, never a value or a provider message.

// Each secret is whatever Deno.env.get returns: a value, or undefined when unset.
export interface HealthDependencies {
  healthCheckToken: string | undefined;
  resendApiKey: string | undefined;
  fromEmail: string | undefined;
  secretKeys: string | undefined;
  sendRequest?: (url: string, init: RequestInit) => Promise<Response>;
  logError?: (code: string, status?: number) => void;
}

type CheckState = 'ok' | 'failed';

export const HEALTH_CHECK_TOKEN_HEADER = 'x-health-check-token';
// A shorter configured value counts as unset, so a placeholder never opens the function.
const MINIMUM_TOKEN_LENGTH = 32;
const CHECK_TIMEOUT_MS = 5000;
const noStore = { 'Cache-Control': 'no-store' };

function unknownFunction(): Response {
  return Response.json(
    { code: 'NOT_FOUND', message: 'Requested function was not found' },
    { status: 404, headers: { 'sb-error-code': 'NOT_FOUND' } },
  );
}

async function hasToken(request: Request, configured: string | undefined): Promise<boolean> {
  const expected = configured?.trim() ?? '';
  if (expected.length < MINIMUM_TOKEN_LENGTH) return false;
  const presented = request.headers.get(HEALTH_CHECK_TOKEN_HEADER) ?? '';
  return timingSafeEquals(await sha256Hex(presented), await sha256Hex(expected));
}

// A read of the account's domains. A key limited to sending is refused with
// the provider's restricted-key code, which still proves the key is valid; a
// revoked or unknown key gets a different answer. The body stays here.
async function checkResendKey(dependencies: HealthDependencies): Promise<CheckState> {
  const logError = dependencies.logError ?? console.error;
  if (!dependencies.resendApiKey?.trim()) {
    logError('health_resend_not_configured');
    return 'failed';
  }
  try {
    const response = await (dependencies.sendRequest ?? fetch)('https://api.resend.com/domains', {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${dependencies.resendApiKey}` },
    });
    if (response.ok) {
      await response.body?.cancel();
      return 'ok';
    }
    const body: unknown = await response.json().catch(() => null);
    if (
      response.status === 401 &&
      body &&
      typeof body === 'object' &&
      'name' in body &&
      body.name === 'restricted_api_key'
    ) {
      return 'ok';
    }
    logError('health_resend_rejected', response.status);
    return 'failed';
  } catch {
    logError('health_resend_unavailable');
    return 'failed';
  }
}

export function createHealthHandler(
  dependencies: HealthDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' || !(await hasToken(request, dependencies.healthCheckToken))) {
      return unknownFunction();
    }
    const checks: Record<string, CheckState> = {
      resend_api_key: await checkResendKey(dependencies),
      from_email: dependencies.fromEmail?.trim() ? 'ok' : 'failed',
      // The platform's secret keys, which the mail functions accept as callers.
      supabase_secret_keys: createMailAuthorizer(
        dependencies.secretKeys === undefined ? {} : { secretKeys: dependencies.secretKeys },
      ).configured
        ? 'ok'
        : 'failed',
    };
    const ok = Object.values(checks).every((state) => state === 'ok');
    return Response.json({ ok, checks }, { status: ok ? 200 : 503, headers: noStore });
  };
}
