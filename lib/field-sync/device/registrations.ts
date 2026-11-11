'use client';

// Every module that registers a sender (sync-runner.ts) or an unsent source
// (unsent-work.ts), imported for that registration alone. Whatever starts the
// runner or asks about unsent work loads this file first: a tab that never
// opened the clock or a report still sends and names what an earlier visit
// left on the phone. One line per module, in the order their work is sent:
// time events first, because a report can depend on them.

export {};
