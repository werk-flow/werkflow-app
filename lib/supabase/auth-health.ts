import 'server-only';

type AuthUsersHealthSample = {
  id: string;
  email: string | null;
};

export type AuthUsersStringColumnHealth = {
  invalidRowCount: number;
  sampleRows: AuthUsersHealthSample[];
};

const EMPTY_AUTH_USERS_STRING_COLUMN_HEALTH: AuthUsersStringColumnHealth = {
  invalidRowCount: 0,
  sampleRows: [],
};

export async function getAuthUsersStringColumnHealth() {
  return EMPTY_AUTH_USERS_STRING_COLUMN_HEALTH;
}

export async function reportAuthUsersStringColumnHealth(context: string) {
  void context;

  // We intentionally keep this as a no-op at runtime.
  //
  // Supabase's auth schema is not exposed through the generated API, and the
  // previous implementation queried `auth.users` through the REST client on
  // every request. That produced noisy false-negative logs during `next start`
  // even when the actual database was healthy.
  //
  // If this diagnostic is ever needed again, it should be reintroduced through
  // a dedicated SQL-backed path instead of request-time REST probing.
}
