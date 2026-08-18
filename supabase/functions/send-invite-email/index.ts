import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'WerkFlow <noreply@werkflow.app>';
const SUPABASE_SECRET_KEYS = Deno.env.get('SUPABASE_SECRET_KEYS');

interface EmailParams {
  to: string;
  inviterName: string;
  organizationName: string;
  inviteUrl: string;
  isExistingUser: boolean;
}

const jsonHeaders = {
  'Content-Type': 'application/json'
};

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

function getAllowedSecretKeys(): string[] {
  if (!SUPABASE_SECRET_KEYS) return [];

  try {
    return collectSecretKeys(JSON.parse(SUPABASE_SECRET_KEYS));
  } catch (error) {
    console.error('Failed to parse SUPABASE_SECRET_KEYS:', error);
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

async function isAuthorized(req: Request): Promise<boolean> {
  const presentedApiKey = getPresentedApiKey(req);
  const allowedSecretKeys = getAllowedSecretKeys();
  const presentedApiKeyHash = presentedApiKey
    ? await sha256Hex(presentedApiKey)
    : null;

  return (
    !!presentedApiKey &&
    allowedSecretKeys.some((secretKey) =>
      timingSafeEquals(presentedApiKey, secretKey) ||
      (!!presentedApiKeyHash && timingSafeEquals(presentedApiKeyHash, secretKey))
    )
  );
}

function generateEmailHtml(params: EmailParams): string {
  const { inviterName, organizationName, inviteUrl, isExistingUser } = params;

  const actionText = isExistingUser
    ? 'Einladung annehmen'
    : 'Konto erstellen & beitreten';

  const descriptionText = isExistingUser
    ? 'Klicke auf den Button unten, um der Organisation beizutreten.'
    : 'Erstelle dein WerkFlow-Konto, um der Organisation beizutreten.';

  return `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Einladung zu ${organizationName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 480px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 32px; text-align: center;">
              <div style="margin-bottom: 24px;">
                <span style="font-size: 24px; font-weight: 700; color: #18181b;">WerkFlow</span>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">
                Du wurdest eingeladen!
              </h1>

              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #52525b;">
                <strong>${inviterName}</strong> hat dich eingeladen, der Organisation <strong>${organizationName}</strong> auf WerkFlow beizutreten.
              </p>

              <p style="margin: 0 0 32px; font-size: 14px; line-height: 1.6; color: #71717a;">
                ${descriptionText}
              </p>

              <a href="${inviteUrl}" style="display: inline-block; padding: 12px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
                ${actionText}
              </a>

              <p style="margin: 32px 0 0; font-size: 12px; color: #a1a1aa;">
                Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; font-size: 12px; color: #a1a1aa;">
          &copy; ${new Date().getFullYear()} WerkFlow. Alle Rechte vorbehalten.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateEmailText(params: EmailParams): string {
  const { inviterName, organizationName, inviteUrl, isExistingUser } = params;

  const actionText = isExistingUser
    ? 'Klicke auf den Link unten, um der Organisation beizutreten:'
    : 'Erstelle dein WerkFlow-Konto und tritt der Organisation bei:';

  return `
Du wurdest eingeladen!

${inviterName} hat dich eingeladen, der Organisation "${organizationName}" auf WerkFlow beizutreten.

${actionText}
${inviteUrl}

Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.

---
WerkFlow
  `.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      },
    });
  }

  if (getAllowedSecretKeys().length === 0) {
    console.error('SUPABASE_SECRET_KEYS is not configured');
    return new Response(
      JSON.stringify({ error: 'Email service is not configured' }),
      { status: 500, headers: jsonHeaders }
    );
  }

  if (!(await isAuthorized(req))) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: jsonHeaders }
    );
  }

  try {
    const params: EmailParams = await req.json();
    const { to, inviterName, organizationName, inviteUrl, isExistingUser } = params;

    if (!to || !inviterName || !organizationName || !inviteUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    console.log('Sending invite email:', { to, isExistingUser });

    if (!RESEND_API_KEY) {
      console.log('RESEND_API_KEY not set. Email would be sent to:', to);
      console.log('Invite URL:', inviteUrl);
      console.log('Is existing user:', isExistingUser);
      return new Response(
        JSON.stringify({ success: true, message: 'Email logged (no API key)' }),
        { status: 200, headers: jsonHeaders }
      );
    }

    const subject = `Einladung zu ${organizationName} auf WerkFlow`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html: generateEmailHtml(params),
        text: generateEmailText(params),
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Resend API error:', errorData);
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: errorData }),
        { status: 500, headers: jsonHeaders }
      );
    }

    const data = await response.json();
    return new Response(
      JSON.stringify({ success: true, id: data.id }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (error) {
    console.error('Error in send-invite-email:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
