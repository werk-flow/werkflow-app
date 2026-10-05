import { expect, mock } from 'bun:test';

let now = 0;
let cleanupFailure: 'none' | 'channel' | 'returned' | 'thrown' = 'none';
let deleted = 0;
let signInFailure: 'none' | 'returned' | 'thrown' = 'none';
let receive: (payload: unknown) => void = () => {};
Date.now = () => now;
const channel = {
  on(event: string, _filter: unknown, callback: (payload: unknown) => void) {
    if (event === 'system') receive = callback;
    return channel;
  },
  subscribe() {
    now += 100;
    receive({ extension: 'postgres_changes', status: 'ok' });
    return channel;
  },
};
mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: async () => {
          now += 10_000;
          return { data: { user: { id: 'owned-probe' } }, error: null };
        },
        deleteUser: async () => {
          deleted += 1;
          if (cleanupFailure === 'thrown') throw new Error('delete threw');
          return { error: cleanupFailure === 'returned' ? new Error('delete refused') : null };
        },
      },
      signInWithPassword: async () => {
        now += 10_000;
        if (signInFailure === 'thrown') throw new Error('sign-in transport failed');
        return {
          data: { session: { access_token: 'fake' } },
          error: signInFailure === 'returned' ? new Error('sign-in denied') : null,
        };
      },
    },
    realtime: { setAuth: async () => {}, disconnect: () => {} },
    channel: () => channel,
    removeChannel: async () => {
      if (cleanupFailure === 'channel') throw new Error('channel failed');
      return 'ok';
    },
  }),
}));
const { probeRealtimeReadiness } = await import('../../../scripts/realtime-probe');
const input = { url: 'http://unused.local', publishableKey: 'fake', secretKey: 'fake' };
expect(await probeRealtimeReadiness(input)).toEqual({ ok: true, elapsedMs: 100 });
expect(deleted).toBe(1);
for (const failure of ['channel', 'returned', 'thrown'] as const) {
  cleanupFailure = failure;
  await expect(probeRealtimeReadiness(input)).rejects.toThrow('cleanup failed for user owned-probe');
}
expect(deleted).toBe(4);

for (const failure of ['returned', 'thrown'] as const) {
  signInFailure = failure;
  try {
    await probeRealtimeReadiness(input);
    throw new Error('Expected combined probe and cleanup failure');
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    if (failure === 'returned') expect(error.message).toContain('sign-in denied');
    else
      expect(
        error.errors.some((cause) => cause instanceof Error && cause.message === 'sign-in transport failed'),
      ).toBe(true);
    expect(error.errors.some((cause) => cause instanceof Error && cause.message === 'delete threw')).toBe(
      true,
    );
  }
}
expect(deleted).toBe(6);
