import { createMailAuthorizer } from '../_shared/mail-auth.ts';
import { escapeHtml } from '../_shared/html.ts';
import { deliverMail, jsonHeaders, type MailDependencies } from '../_shared/mail-delivery.ts';

interface EmailParams {
  to: string;
  inviterName: string;
  organizationName: string;
  inviteUrl: string;
  isExistingUser: boolean;
}


function isEmailParams(value: unknown): value is EmailParams {
  return !!value && typeof value === 'object' &&
    'to' in value && typeof value.to === 'string' && value.to.length > 0 &&
    'inviterName' in value && typeof value.inviterName === 'string' && value.inviterName.length > 0 &&
    'organizationName' in value && typeof value.organizationName === 'string' && value.organizationName.length > 0 &&
    'inviteUrl' in value && typeof value.inviteUrl === 'string' && value.inviteUrl.length > 0 &&
    'isExistingUser' in value && typeof value.isExistingUser === 'boolean';
}

function generateEmailHtml(params: EmailParams): string {
  const { inviteUrl, isExistingUser } = params;
  const inviterName = escapeHtml(params.inviterName);
  const organizationName = escapeHtml(params.organizationName);

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

              <a href="${escapeHtml(inviteUrl)}" style="display: inline-block; padding: 12px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;">
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

export function createInviteEmailHandler(dependencies: MailDependencies): (request: Request) => Promise<Response> {
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
      const { to, organizationName } = params;

      return await deliverMail(dependencies, {
        to,
        subject: `Einladung zu ${organizationName} auf WerkFlow`,
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
