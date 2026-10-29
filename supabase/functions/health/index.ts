import { createHealthHandler } from './handler.ts';

Deno.serve(
  createHealthHandler({
    healthCheckToken: Deno.env.get('HEALTH_CHECK_TOKEN'),
    resendApiKey: Deno.env.get('RESEND_API_KEY'),
    fromEmail: Deno.env.get('FROM_EMAIL'),
    secretKeys: Deno.env.get('SUPABASE_SECRET_KEYS'),
  }),
);
