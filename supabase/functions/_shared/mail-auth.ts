import type { MailDependencies } from './mail-delivery.ts';

function timingSafeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLength = Math.max(aBytes.length, bBytes.length);
  let mismatch = aBytes.length === bBytes.length ? 0 : 1;

  for (let i = 0; i < maxLength; i++) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }

  return mismatch === 0;
}

function collectSecretKeys(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.startsWith('sb_secret_') || /^[a-f0-9]{64}$/i.test(value)
      ? [value]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectSecretKeys);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectSecretKeys);
  }

  return [];
}

function getAllowedSecretKeys(dependencies: MailDependencies): string[] {
  if (!dependencies.secretKeys) return [];

  try {
    return collectSecretKeys(JSON.parse(dependencies.secretKeys));
  } catch {
    (dependencies.logError ?? console.error)('mail_auth_configuration_invalid');
    return [];
  }
}

function getPresentedApiKey(req: Request): string | null {
  const apiKey = req.headers.get('apikey');
  if (apiKey) return apiKey;

  const authorization = req.headers.get('authorization');
  const bearerPrefix = 'Bearer ';
  if (authorization?.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length);
  }

  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createMailAuthorizer(dependencies: MailDependencies): {
  configured: boolean;
  authorize: (request: Request) => Promise<boolean>;
} {
  const allowedSecretKeys = getAllowedSecretKeys(dependencies);
  return {
    configured: allowedSecretKeys.length > 0,
    authorize: async (request: Request): Promise<boolean> => {
      const presentedApiKey = getPresentedApiKey(request);
      if (!presentedApiKey) return false;
      const presentedApiKeyHash = await sha256Hex(presentedApiKey);
      return allowedSecretKeys.some((secretKey) =>
        timingSafeEquals(presentedApiKey, secretKey) ||
        timingSafeEquals(presentedApiKeyHash, secretKey)
      );
    },
  };
}
