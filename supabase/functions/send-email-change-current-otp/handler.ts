import { createMailAuthorizer } from '../_shared/mail-auth.ts';
import { escapeHtml } from '../_shared/html.ts';
import { deliverMail, jsonHeaders, type MailDependencies } from '../_shared/mail-delivery.ts';

type EmailChangeOtpKind = 'current' | 'new';

interface EmailChangeOtpParams {
  to: string;
  code: string;
  firstName?: string | null;
  expiresInMinutes?: number;
  kind?: EmailChangeOtpKind;
}


function isEmailParams(value: unknown): value is EmailChangeOtpParams {
  return !!value && typeof value === 'object' &&
    'to' in value && typeof value.to === 'string' && value.to.length > 0 &&
    'code' in value && typeof value.code === 'string' && /^\d{6}$/.test(value.code) &&
    (!('kind' in value) || value.kind === 'current' || value.kind === 'new') &&
    (!('firstName' in value) || value.firstName === null || typeof value.firstName === 'string') &&
    (!('expiresInMinutes' in value) || (typeof value.expiresInMinutes === 'number' &&
      Number.isFinite(value.expiresInMinutes) && value.expiresInMinutes > 0));
}

function getCopy(kind: EmailChangeOtpKind) {
  if (kind === 'new') {
    return {
      title: 'Neue E-Mail-Adresse bestätigen',
      subject: 'Bestätige deine neue E-Mail-Adresse',
      intro:
        'wir haben eine Anfrage erhalten, diese E-Mail-Adresse für dein WerkFlow-Konto zu hinterlegen. Bitte gib den folgenden sechsstelligen Code in der App ein, um die neue Adresse zu bestätigen.',
      outro:
        'Wenn du diese Änderung nicht selbst gestartet hast, kannst du diese E-Mail ignorieren.',
    };
  }

  return {
    title: 'Aktuelle E-Mail-Adresse bestätigen',
    subject: 'Bestätige die Änderung deiner E-Mail-Adresse',
    intro:
      'wir haben eine Anfrage erhalten, die E-Mail-Adresse deines WerkFlow-Kontos zu ändern. Bitte gib den folgenden sechsstelligen Code in der App ein, um mit der Änderung fortzufahren.',
    outro:
      'Wenn du diese Änderung nicht selbst gestartet hast, musst du nichts weiter tun.',
  };
}

function generateEmailHtml(params: EmailChangeOtpParams): string {
  const { code, firstName, expiresInMinutes = 10, kind = 'current' } = params;
  const greeting = firstName?.trim() ? `Hallo ${escapeHtml(firstName.trim())},` : 'Hallo,';
  const copy = getCopy(kind);
  const safeCode = escapeHtml(code);
  const safeExpiry = escapeHtml(expiresInMinutes);

  return `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${copy.title}</title>
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
                ${copy.title}
              </h1>

              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #52525b; text-align: left;">
                ${greeting}<br /><br />
                ${copy.intro}
              </p>

              <div style="margin: 0 0 24px; padding: 16px; border-radius: 12px; background-color: #f4f4f5; font-size: 32px; font-weight: 700; letter-spacing: 0.35em; color: #18181b;">
                ${safeCode}
              </div>

              <p style="margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #71717a; text-align: left;">
                Der Code ist ${safeExpiry} Minuten gültig. ${copy.outro}
              </p>

              <p style="margin: 24px 0 0; font-size: 12px; color: #a1a1aa;">
                &copy; ${new Date().getFullYear()} WerkFlow. Alle Rechte vorbehalten.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function generateEmailText(params: EmailChangeOtpParams): string {
  const { code, firstName, expiresInMinutes = 10, kind = 'current' } = params;
  const greeting = firstName?.trim() ? `Hallo ${firstName.trim()},` : 'Hallo,';
  const copy = getCopy(kind);

  return `
${greeting}

${copy.intro}

Bitte gib diesen sechsstelligen Code in der App ein:
${code}

Der Code ist ${expiresInMinutes} Minuten gültig. ${copy.outro}

---
WerkFlow
  `.trim();
}

export function createEmailChangeOtpHandler(dependencies: MailDependencies): (request: Request) => Promise<Response> {
  const authorization = createMailAuthorizer(dependencies);
  const logError = dependencies.logError ?? console.error;
  return async (req: Request): Promise<Response> => {
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

    if (!authorization.configured) {
      logError('mail_auth_not_configured');
      return new Response(
        JSON.stringify({ error: 'Email service is not configured' }),
        { status: 500, headers: jsonHeaders }
      );
    }

    if (!(await authorization.authorize(req))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: jsonHeaders }
      );
    }

    try {
      const input: unknown = await req.json();
      if (!isEmailParams(input)) {
        return Response.json({ error: 'Invalid email parameters' }, { status: 400 });
      }
      const params = input;
      const { to, kind = 'current' } = params;

      return await deliverMail(dependencies, {
        to,
        subject: getCopy(kind).subject,
        html: generateEmailHtml(params),
        text: generateEmailText(params),
      });
    } catch {
      logError('mail_request_invalid');
      return new Response(
        JSON.stringify({ error: 'Invalid email parameters' }),
        { status: 400, headers: jsonHeaders }
      );
    }
  };
}
