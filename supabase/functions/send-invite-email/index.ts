import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createInviteEmailHandler } from './handler.ts';

Deno.serve(createInviteEmailHandler({
  resendApiKey: Deno.env.get('RESEND_API_KEY'),
  fromEmail: Deno.env.get('FROM_EMAIL'),
  secretKeys: Deno.env.get('SUPABASE_SECRET_KEYS'),
  localMailCapture: Deno.env.get('WERKFLOW_LOCAL_MAIL_CAPTURE'),
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
}));
