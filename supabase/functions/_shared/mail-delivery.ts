type MailErrorCode = 'mail_provider_not_configured' | 'mail_provider_rejected' |
  'mail_provider_invalid_response' | 'mail_provider_unavailable' |
  'mail_auth_configuration_invalid' | 'mail_auth_not_configured' | 'mail_request_invalid';

export interface MailDependencies {
  resendApiKey?: string;
  fromEmail?: string;
  secretKeys?: string;
  localMailCapture?: string;
  supabaseUrl?: string;
  sendRequest?: (url: string, init: RequestInit) => Promise<Response>;
  logError?: (code: MailErrorCode, status?: number) => void;
}

export const jsonHeaders = { 'Content-Type': 'application/json' };

/** Never return or log provider payloads: they can contain addresses and capabilities. */
export async function deliverMail(
  dependencies: MailDependencies,
  message: { to: string; subject: string; html: string; text: string },
): Promise<Response> {
  const logError = dependencies.logError ?? console.error;
  const localCapture = dependencies.localMailCapture === 'mailpit' && dependencies.supabaseUrl === 'http://kong:8000';
  // Local capture requires both explicit local configuration and the CLI's exact
  // private gateway. Hosted functions must never silently capture instead of send.
  if ((!localCapture && !dependencies.resendApiKey?.trim()) ||
      (dependencies.localMailCapture && !localCapture)) {
    logError('mail_provider_not_configured');
    return Response.json({ error: 'Email service is not configured' }, { status: 503 });
  }
  try {
    const response = await (dependencies.sendRequest ?? fetch)(localCapture
      ? 'http://supabase_inbucket_werkflow-app:8025/api/v1/send'
      : 'https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(localCapture ? {} : { Authorization: `Bearer ${dependencies.resendApiKey}` }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(localCapture ? {
        From: { Name: 'WerkFlow Local', Email: 'noreply@werkflow.test' },
        To: [{ Email: message.to }], Subject: message.subject, HTML: message.html, Text: message.text,
      } : {
        from: dependencies.fromEmail || 'WerkFlow <noreply@werkflow.app>',
        ...message,
        to: [message.to],
      }),
    });
    if (!response.ok) {
      logError('mail_provider_rejected', response.status);
      return Response.json({ error: 'Failed to send email' }, { status: 502 });
    }
    const result: unknown = await response.json();
    const identifier = result && typeof result === 'object'
      ? localCapture && 'ID' in result ? result.ID : !localCapture && 'id' in result ? result.id : undefined
      : undefined;
    // Mailpit uses a 22-character short UUID; Resend returns a standard UUID.
    const identifierPattern = localCapture ? /^[A-Za-z0-9]{22}$/ : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof identifier !== 'string' || !identifierPattern.test(identifier)) {
      logError('mail_provider_invalid_response');
      return Response.json({ error: 'Failed to send email' }, { status: 502 });
    }
    return Response.json({ success: true, id: identifier });
  } catch {
    logError('mail_provider_unavailable');
    return Response.json({ error: 'Failed to send email' }, { status: 502 });
  }
}
