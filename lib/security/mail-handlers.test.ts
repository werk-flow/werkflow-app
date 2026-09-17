import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInviteEmailHandler } from '../../supabase/functions/send-invite-email/handler';
import { createEmailChangeOtpHandler } from '../../supabase/functions/send-email-change-current-otp/handler';

const apiKey = 'sb_secret_synthetic-mail-test';
const privateMarker = 'private@example.test 924617 https://example.test/invite?code=secret';
const messageId = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794';
const localMessageId = 'aBcDeFgHiJkLmNoPqRsTuV';
const cases = [
  {
    name: 'send-invite-email', factory: createInviteEmailHandler,
    body: { to: 'private@example.test', inviterName: '<script>private</script>', organizationName: 'SHK & Co',
      inviteUrl: 'https://example.test/invite?code=secret', isExistingUser: false },
  },
  {
    name: 'send-email-change-current-otp', factory: createEmailChangeOtpHandler,
    body: { to: 'private@example.test', code: '924617', firstName: '<script>private</script>' },
  },
];

function request(body: unknown, authorized = true): Request {
  return new Request('https://example.test/mail', {
    method: 'POST', headers: { apikey: authorized ? apiKey : 'wrong', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

for (const example of cases) {
  test(`${example.name}: explicit local delivery requires actual Mailpit acceptance`, async () => {
    const deliveries: { url: string; init: RequestInit }[] = [];
    const logs: unknown[] = [];
    const handler = example.factory({
      secretKeys: JSON.stringify([apiKey]), localMailCapture: 'mailpit', supabaseUrl: 'http://kong:8000',
      logError: (...values) => logs.push(values),
      sendRequest: async (url, init) => { deliveries.push({ url, init }); return Response.json({ ID: localMessageId }); },
    });
    const response = await handler(request(example.body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: localMessageId });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.url).toBe('http://supabase_inbucket_werkflow-app:8025/api/v1/send');
    expect(deliveries[0]?.init.redirect).toBe('error');
    expect(new Headers(deliveries[0]?.init.headers).has('Authorization')).toBe(false);
    expect(JSON.parse(String(deliveries[0]?.init.body)).To).toEqual([{ Email: example.body.to }]);
    expect(logs).toEqual([]);
  });

  test(`${example.name}: cloud cannot enable the local capture fallback`, async () => {
    let sends = 0;
    for (const supabaseUrl of ['https://project.supabase.co', 'http://kong:8000.evil.test', undefined]) {
      const handler = example.factory({ secretKeys: JSON.stringify([apiKey]), localMailCapture: 'mailpit',
        ...(supabaseUrl !== undefined ? { supabaseUrl } : {}), resendApiKey: 're_synthetic', logError: () => {},
        sendRequest: async () => { sends++; return Response.json({ ID: messageId }); } });
      expect((await handler(request(example.body))).status).toBe(503);
    }
    expect(sends).toBe(0);
  });

  test(`${example.name}: rejected, missing and malformed local capture never reports successful delivery`, async () => {
    for (const failure of ['rejected', 'network', 'malformed'] as const) {
      const logs: unknown[] = [];
      const handler = example.factory({ secretKeys: JSON.stringify([apiKey]), localMailCapture: 'mailpit',
        supabaseUrl: 'http://kong:8000', logError: (...values) => logs.push(values),
        sendRequest: async () => {
          if (failure === 'network') throw new Error(privateMarker);
          return failure === 'rejected' ? new Response(privateMarker, { status: 503 }) : Response.json({ ID: privateMarker });
        } });
      const response = await handler(request(example.body));
      expect(response.status).toBe(502);
      expect(JSON.stringify(logs)).not.toContain('private');
      expect(await response.json()).toEqual({ error: 'Failed to send email' });
    }
  });

  test(`${example.name}: missing provider key fails without sending or disclosing the message`, async () => {
    const logs: unknown[] = [];
    let sends = 0;
    const handler = example.factory({
      secretKeys: JSON.stringify([apiKey]), logError: (...values) => logs.push(values),
      sendRequest: async () => { sends++; return Response.json({ id: messageId }); },
    });
    const response = await handler(request(example.body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Email service is not configured' });
    expect(sends).toBe(0);
    expect(logs).toEqual([['mail_provider_not_configured']]);
  });

  for (const failure of ['rejection', 'network', 'malformed-success', 'private-id'] as const) {
    test(`${example.name}: ${failure} does not expose provider text or report delivery`, async () => {
      const logs: unknown[] = [];
      const handler = example.factory({
        secretKeys: JSON.stringify([apiKey]), resendApiKey: 're_synthetic',
        logError: (...values) => logs.push(values),
        sendRequest: async () => {
          if (failure === 'network') throw new Error(privateMarker);
          if (failure === 'rejection') return new Response(privateMarker, { status: 422 });
          if (failure === 'private-id') return Response.json({ id: privateMarker });
          return new Response(privateMarker);
        },
      });
      const response = await handler(request(example.body));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'Failed to send email' });
      expect(JSON.stringify(logs)).not.toContain('private');
      expect(JSON.stringify(logs)).not.toContain('924617');
      expect(JSON.stringify(logs)).not.toContain('secret');
      expect(logs).toHaveLength(1);
    });
  }

  test(`${example.name}: authorization and parameter failures never reach delivery`, async () => {
    let sends = 0;
    const logs: unknown[] = [];
    const handler = example.factory({
      secretKeys: JSON.stringify([apiKey]), resendApiKey: 're_synthetic',
      logError: (...values) => logs.push(values),
      sendRequest: async () => { sends++; return Response.json({ id: messageId }); },
    });
    expect((await handler(request(example.body, false))).status).toBe(401);
    expect((await handler(request({ ...example.body, to: { privateMarker } }))).status).toBe(400);
    expect((await handler(request(null))).status).toBe(400);
    expect(sends).toBe(0);
    expect(logs).toEqual([]);
  });

  test(`${example.name}: malformed secret configuration is redacted and hashed keys still authenticate`, async () => {
    const logs: unknown[] = [];
    let sends = 0;
    const dependencies = {
      resendApiKey: 're_synthetic', logError: (...values: unknown[]) => logs.push(values),
      sendRequest: async () => { sends++; return Response.json({ id: messageId }); },
    };
    const invalid = example.factory({ ...dependencies, secretKeys: privateMarker });
    expect((await invalid(request(example.body))).status).toBe(500);
    expect(sends).toBe(0);
    expect(JSON.stringify(logs)).not.toContain('private');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
    const hashedKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const valid = example.factory({ ...dependencies, secretKeys: JSON.stringify([hashedKey]) });
    expect((await valid(request(example.body))).status).toBe(200);
    expect(sends).toBe(1);
  });

  test(`${example.name}: actual handler sends escaped content and returns only delivery identity`, async () => {
    const sent: RequestInit[] = [];
    const logs: unknown[] = [];
    const handler = example.factory({
      secretKeys: JSON.stringify([apiKey]), resendApiKey: 're_synthetic',
      logError: (...values) => logs.push(values),
      sendRequest: async (url, init) => {
        expect(url).toBe('https://api.resend.com/emails');
        sent.push(init);
        return Response.json({ id: messageId, message: privateMarker });
      },
    });
    const response = await handler(request(example.body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: messageId });
    expect(sent).toHaveLength(1);
    const body = JSON.parse(String(sent[0]?.body));
    expect(body.to).toEqual(['private@example.test']);
    expect(body.html).toContain('&lt;script&gt;private&lt;/script&gt;');
    expect(body.html).not.toContain('<script>');
    expect(logs).toEqual([]);
  });

  test(`${example.name}: deployment entry uses the tested handler and permits no payload logging`, () => {
    const directory = resolve(import.meta.dir, '../../supabase/functions', example.name);
    const entry = readFileSync(resolve(directory, 'index.ts'), 'utf8');
    expect(entry).toContain(`Deno.serve(${example.factory.name}({`);
    expect(entry).toContain("from './handler.ts'");
    // Future logging must use the deliberately payload-free dependency contract.
    for (const file of ['index.ts', 'handler.ts', '../_shared/mail-delivery.ts', '../_shared/mail-auth.ts', '../_shared/html.ts']) {
      expect(readFileSync(resolve(directory, file), 'utf8')).not.toMatch(/console\.(error|log|warn|info|debug)\s*\(/);
    }
  });
}
