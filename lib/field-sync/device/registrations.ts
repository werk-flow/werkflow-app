'use client';

import { sendOwnTimeEvents, timeUnsentSource } from './clock-device';
import { sendDrafts } from './draft-sync';
import { draftUnsentSource } from './draft-unsent-source';
import { registerSender } from './sync-runner';
import { registerUnsentSource } from './unsent-work';

// Every sender (sync-runner.ts) and unsent source (unsent-work.ts) of the
// phone, registered in one place. Whatever starts the runner or asks about
// unsent work imports this file first: a tab that never opened the clock or a
// report still sends and names what an earlier visit left on the phone. In
// the order their work is sent: time events first, because a report can
// depend on them.

registerSender(timeUnsentSource.name, sendOwnTimeEvents);
registerUnsentSource(timeUnsentSource);
registerSender(draftUnsentSource.name, sendDrafts);
registerUnsentSource(draftUnsentSource);
