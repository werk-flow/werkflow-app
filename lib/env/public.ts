import { readRequiredEnv } from '@/lib/env/required';

export function getSupabaseUrl(): string {
  return readRequiredEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    'Missing NEXT_PUBLIC_SUPABASE_URL environment variable.',
  );
}

export function getOptionalSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
}

export function getSupabasePublishableKey(): string {
  return readRequiredEnv(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
    'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variable.',
  );
}
