// The machine runner mints the CI App's token itself (check-app-token.ts): a JWT the App's public
// key verifies, for one repository and `checks: write` only.
import { expect, test } from 'bun:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { installationToken } from './check-app-token';

test("an installation token is asked for with the App's signed JWT, for one repository and checks: write only", async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const requests: { url: string; init: RequestInit }[] = [];
  const answers = [{ id: 77 }, { token: 'ghs_minted', expires_at: '2026-11-23T03:00:00Z' }];
  const minted = await installationToken({
    appId: 4242,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    repository: 'werk-flow/werkflow-app',
    nowS: 1_795_000_000,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json(answers.shift());
    },
  });
  expect(minted).toEqual({ token: 'ghs_minted', expiresAt: Date.parse('2026-11-23T03:00:00Z') / 1_000 });
  expect(requests.map((request) => request.url)).toEqual([
    'https://api.github.com/repos/werk-flow/werkflow-app/installation',
    'https://api.github.com/app/installations/77/access_tokens',
  ]);
  expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
    repositories: ['werkflow-app'],
    permissions: { checks: 'write' },
  });
  const authorization = new Headers(requests[0]?.init.headers).get('Authorization') ?? '';
  const [header, payload, signature] = authorization.replace('Bearer ', '').split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  expect(verifier.verify(publicKey, Buffer.from(signature ?? '', 'base64url'))).toBe(true);
  expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toEqual({
    iat: 1_795_000_000 - 60,
    exp: 1_795_000_000 + 540,
    iss: '4242',
  });
});
