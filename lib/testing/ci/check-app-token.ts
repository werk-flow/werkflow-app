// An installation token of the CI App (.github/scripts/check-app.json) with `checks: write` on one
// repository, minted from the App's private key: what scripts/ci/publish-check.ts takes as
// CI_CHECK_APP_TOKEN, here for the machine runner (scripts/ci/machine-runner.ts), which reads the
// key from its configuration's `appKeyFile` and never hands key or token to a job.
import { createSign } from 'node:crypto';
import { z } from 'zod';

const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

/** The App's JSON Web Token: RS256, valid from a minute ago for nine minutes (GitHub allows ten). */
function appJwt(appId: number, privateKey: string, nowS: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: nowS - 60, exp: nowS + 540, iss: String(appId) }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

const installationSchema = z.object({ id: z.number().int().positive() });
const tokenSchema = z.object({ token: z.string().min(1), expires_at: z.string().datetime() });

/** A token for `repository` (`owner/name`) with `checks: write` only, and when it expires. */
export async function installationToken(input: {
  appId: number;
  privateKey: string;
  repository: string;
  nowS: number;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<{ token: string; expiresAt: number }> {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${appJwt(input.appId, input.privateKey, input.nowS)}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const found = await input.fetch(`https://api.github.com/repos/${input.repository}/installation`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!found.ok) throw new Error(`GitHub answered ${found.status} for the App's installation.`);
  const { id } = installationSchema.parse(await found.json());
  const minted = await input.fetch(`https://api.github.com/app/installations/${id}/access_tokens`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repositories: [input.repository.split('/')[1]],
      permissions: { checks: 'write' },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!minted.ok) throw new Error(`GitHub answered ${minted.status} for an installation token.`);
  const { token, expires_at } = tokenSchema.parse(await minted.json());
  return { token, expiresAt: Math.floor(Date.parse(expires_at) / 1_000) };
}
