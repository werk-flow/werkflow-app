// The frame of WerkFlow's own billing mails and alarms, in the design of the
// existing mails (supabase/functions/send-invite-email): one white card on a
// grey page, the WerkFlow name, a heading, paragraphs, an optional facts
// table and one optional button. Every interpolated value is escaped here.
// Mail clients ignore stylesheets, so the colors are inline literals.

import { escapeHtml } from '@/lib/format/html';

export type RenderedMail = { subject: string; html: string; text: string };

export type MailContent = {
  subject: string;
  heading: string;
  paragraphs: readonly string[];
  facts?: readonly (readonly [label: string, value: string])[];
  action?: { label: string; url: string };
  footnote?: string;
};

const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** An amount in cents as German euros, for example „49,00 €“. */
export function formatEuro(cents: number): string {
  return euroFormat.format(cents / 100);
}

const TEXT = 'margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #52525b;';
const BUTTON =
  'display: inline-block; padding: 12px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; border-radius: 8px;';

export function renderMail(content: MailContent): RenderedMail {
  const paragraphs = content.paragraphs.map((paragraph) => `<p style="${TEXT}">${escapeHtml(paragraph)}</p>`);
  const facts = content.facts?.length
    ? `<table role="presentation" style="width: 100%; border-collapse: collapse; margin: 8px 0 24px; font-size: 14px;">${content.facts
        .map(
          ([label, value]) =>
            `<tr><td style="padding: 6px 0; color: #71717a;">${escapeHtml(label)}</td><td style="padding: 6px 0 6px 16px; color: #18181b; text-align: right; font-weight: 500;">${escapeHtml(value)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const action = content.action
    ? `<p style="margin: 8px 0 24px;"><a href="${escapeHtml(content.action.url)}" style="${BUTTON}">${escapeHtml(content.action.label)}</a></p>`
    : '';
  const footnote = content.footnote
    ? `<p style="margin: 24px 0 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">${escapeHtml(content.footnote)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
<table role="presentation" style="width: 100%; border-collapse: collapse;"><tr><td align="center" style="padding: 40px 20px;">
<table role="presentation" style="max-width: 520px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);"><tr><td style="padding: 40px 32px;">
<div style="margin-bottom: 24px;"><span style="font-size: 24px; font-weight: 700; color: #18181b;">WerkFlow</span></div>
<h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">${escapeHtml(content.heading)}</h1>
${[...paragraphs, facts, action, footnote].filter(Boolean).join('\n')}
</td></tr></table>
</td></tr></table>
</body>
</html>`;

  const text = [
    content.heading,
    ...content.paragraphs,
    ...(content.facts ?? []).map(([label, value]) => `${label}: ${value}`),
    ...(content.action ? [`${content.action.label}: ${content.action.url}`] : []),
    ...(content.footnote ? [content.footnote] : []),
    '--\nWerkFlow',
  ].join('\n\n');

  return { subject: content.subject, html, text };
}
