# 0010 — Offline field sync contract

- **Status:** accepted (2026-11-09)
- **Date:** 2026-11-09
- **Owner:** Product owner (Tamay), who set the offline time window and the device data rule on 2026-11-09 (werk-flow/werkflow-planning#22)
- **Affects:** every phone write that can start without signal, its server endpoints and device storage; [architecture](../technical/architecture.md#offline-field-sync) states the rule, [security](../technical/security.md#browser) the device data line

## Context

A field worker loses signal in a basement or on a remote site and still has to record time, a report and photos. The web phone interface must keep that work across signal loss and a restart, then send it once the signal returns. A React Native client follows in V2. If the server side were built around browser features, the native client would need a second contract, and money-relevant time events would have two replay paths to keep correct.

## Decision

### One server contract for web and native

1. Offline field work syncs through versioned route handlers under `/api/field-sync/v1/`. Never through a Server Action: its endpoint ids change per build, it carries no version, and a native client cannot call it.
2. A handler accepts the Supabase session cookie or an `Authorization: Bearer` access token and resolves both to the same caller context. A cookie-authenticated request passes `verifySameOriginJsonRequest` first.
3. Requests and responses are JSON. No `FormData`, `Blob`, `File` or other browser type reaches the server path.
4. File bytes go to storage directly through a signed URL ([add a storage path](../technical/security.md#add-a-storage-path)). A sync operation carries the storage key, never bytes.
5. Only device storage is web-specific: IndexedDB, Cache Storage and the service worker sit behind one small client interface, which the native client replaces.
6. A breaking change to the envelope or an outcome code goes to `/v2/`. `v1` stays served until no supported client sends it.

### The operation envelope

Every write is one operation:

| Field | Rule |
| --- | --- |
| `operationId` | A UUID the device creates once, when the user acts. It is the idempotency key and never changes on a resend. |
| `kind` | The operation type, such as a time event. The server accepts only kinds `v1` names. |
| `capturedAt` | The device clock when the user acted. |
| `sentAt` | The device clock at this send. The server compares it with its own receipt time to measure clock skew. |
| `organizationId` | A hint. The server resolves the caller's organization itself and refuses a mismatch; it never switches to the hinted one. |
| `payload` | The kind's fields, parsed with a schema before first use. |

The server stores a hash of the normalized envelope without `sentAt`. The same `operationId` with the same hash returns the stored result as `replayed`. The same `operationId` with a different hash is refused with `idempotency_conflict`. Time transitions already work this way inside `transition_time_activity`.

### Outcome classes

Each response carries `{ outcome, code }`. The client branches on `outcome`, shows `code` through its own German copy, and never parses a message.

| Outcome | Meaning | Device shows | Example codes |
| --- | --- | --- | --- |
| `accepted` | Written now. | sent | `accepted` |
| `replayed` | Written by an earlier send of this `operationId`. | sent | `replayed` |
| `rejected` | Permanent: identity, permission, closed period, validation, an expired window, or an `operationId` reused with other content. | failed, kept until the user or the office resolves it | `forbidden`, `organization_mismatch`, `closed_period`, `invalid`, `outside_recording_window`, `idempotency_conflict` |
| `conflict` | The server state moved: an expected version no longer holds, the office changed the record, or the event needs the office. | conflicted, never overwritten automatically | `version_conflict`, `office_changed`, `correction_requested` |
| `retry` | Transient: network, timeout, server error, a session that needs a new token. | pending | `unavailable`, `unauthenticated` |

The codes are stable. A new code comes with its client handling. An unknown code counts as `retry` for a 5xx status and as `rejected` otherwise, so a newer server never makes an old client drop an operation.

### Replay rechecks everything

A replayed operation is a fresh request. At replay time the server establishes identity, organization, role, object permission, lifecycle and closed periods ([add a Server Action or route handler](../technical/security.md#add-a-server-action-or-route-handler)). Nothing the device stored at capture time counts as proof. A write that needs atomic authorization reauthorizes inside its database function ([Supabase access model](../technical/architecture.md#supabase-access-model)). A revoked membership, a lower role, a foreign organization's id and a closed period each end in `rejected`, proven by a boundary test on the real handler.

### Conflict rules

- Server state wins. A device never overwrites an office change; it shows the conflict and the server's current state.
- Recorded time changes only through the versioned time function or an audited correction. A conflicted, rejected or late time event is never dropped: it stays visible on the device until resolved.
- **Offline time window.** An event captured without signal keeps the phone's captured time and is marked offline-captured. The server accepts it automatically when it arrives within 24 hours of `capturedAt` and outside a closed period. A later event becomes an audited correction request for the office (`correction_requested`). After 7 days, the recording deadline of the minimum wage law, the server refuses it (`outside_recording_window`). Both limits are one server value each, so field research can change them without a client release. The time server work (werk-flow/werkflow-planning#317) fixes the clock-skew tolerance and stores captured, sent and received times for the audit.

### Device data

A phone keeps only the signed-in user's own assignments for the current Berlin day. It deletes them on the next Berlin day, on sign-out and on an organization switch. The server never trusts device data. Unsent operations are the user's work, not a cache: sign-out first tries to send them and names what stays unsent before the user confirms.

### Sync triggers

There is no background sync on iOS (see below). The client sends on app start, on the `online` event, on `visibilitychange` to visible, and on an explicit „Jetzt senden“ action. Code that sends on another trigger also sends on these.

## The iOS Safari limits we design around

Each limit names the version it applies to and its primary source.

| Limit | Applies to | Design consequence | Source |
| --- | --- | --- | --- |
| No Background Sync API: Safari ships no `SyncManager`, on macOS or iOS. | Every Safari release to date | Sync runs only while the app is open, on the triggers above. | [MDN browser-compat-data, `api.SyncManager`](https://github.com/mdn/browser-compat-data/blob/main/api/SyncManager.json) (`version_added: false`, [WebKit bug 182565](https://webkit.org/b/182565)); [MDN, Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) |
| Script-writable storage (IndexedDB, LocalStorage, service worker registrations and Cache Storage) is deleted after seven days of Safari use without user interaction on the site. A Home Screen web app is not part of Safari and has its own counter of days of use. | iOS and iPadOS 13.4, Safari 13.1 and later | Field workers use the Home Screen web app. The device holds only today's data, so an eviction loses at most unsent operations, which the app sends on every open. | [WebKit blog, Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) |
| Origins default to best-effort storage, evicted least-recently-used under storage pressure or after a period without use. An active page and a persistent origin are exempt. | Safari 17, iOS and iPadOS 17 and later | The app calls `navigator.storage.persist()` and records its answer; it never assumes persistence. | [WebKit blog, Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) |
| `navigator.storage.persist()` exists; WebKit grants it by heuristics such as whether the site is opened as a Home Screen web app. | `persist()` since Safari 15.2; the grant heuristics since Safari 17 | A refused `persist()` is a normal state, shown in no error. | [MDN browser-compat-data, `api.StorageManager`](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json); [WebKit blog, Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) |
| Quotas: an origin may use up to 60 % of the disk in a browser app and 15 % in other apps; all origins together up to 80 % and 20 %. A Home Screen web app has the browser quotas. `navigator.storage.estimate()` reports usage and the origin quota, an upper bound, not a guarantee. | Safari 17, iOS and iPadOS 17 and later; `estimate()` since Safari 17 | Every device write handles `QuotaExceededError` as a visible failure. Photos stay drafts only until upload. | [WebKit blog, Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/); [MDN browser-compat-data, `api.StorageManager`](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json) |
| A Home Screen web app has cookies and storage separate from Safari. Local storage is not copied at install; a login in Safari does not sign in the web app. | iOS and iPadOS, as Apple stated for iOS 17 | The app keeps its session in cookies and never expects data from a Safari tab. A device test installs the web app and signs in inside it. | [Apple, WWDC23 "What's new in web apps"](https://developer.apple.com/videos/play/wwdc2023/10120/) |
| `<input type="file" accept="image/*" capture>` opens the camera. | iOS Safari 10 and later | The photo draft uses the file input first; it needs no camera permission flow. | [MDN browser-compat-data, `html.elements.input.capture`](https://github.com/mdn/browser-compat-data/blob/main/html/elements/input.json); [HTML spec, the `capture` attribute](https://w3c.github.io/html-media-capture/#the-capture-attribute) |
| `getUserMedia` works in a Home Screen web app in standalone mode. Permission goes through the system prompt and Privacy & Security settings. Regressions in standalone mode have been reported across releases. | iOS 13.4 and later; permission model as of iOS 17 | A live camera view stays optional; the file input remains the fallback. | [WebKit bug 185448 (resolved, fixed)](https://bugs.webkit.org/show_bug.cgi?id=185448); [Apple, WWDC23 "What's new in web apps"](https://developer.apple.com/videos/play/wwdc2023/10120/) |
| EU: Apple planned to remove Home Screen web apps in the EU with iOS 17.4, then kept them, built on WebKit. Its current DMA page names no web app restriction. Any site added to the Home Screen opens as a web app on iOS 26. | iOS 17.4 and later; iOS 26 | Field workers in Germany can install the web app. The device test checks it on a device set to the EU region. | [Apple, DMA and apps in the EU](https://developer.apple.com/support/dma-and-apps-in-the-eu/); [WebKit blog, WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) |

Apple's 2024 statement that kept the EU web apps is no longer on its developer site; only news coverage quotes it. A change in the EU status reopens this record.

## The device test matrix

Android Chrome and iOS Safari are equal targets: many field workers use Android phones, privately and as work phones. A field journey passes on both.

| Device | Proves | Cannot prove |
| --- | --- | --- |
| Mac Safari | WebKit's IndexedDB, Cache Storage and service worker behavior, a reload with the Mac's network turned off | Home Screen install, iOS storage separation, eviction, the camera |
| iOS simulator | The Home Screen web app, its separate storage, standalone mode, sign-in inside the web app, offline through the Mac's network | Real eviction under storage pressure, the camera, real signal loss |
| Android emulator, Chrome, current Android with Google Play | Chrome's install to the home screen, the installed app's standalone mode and storage, offline through the emulator's network, the camera input with the emulated camera | Real eviction under storage pressure, real signal loss, a manufacturer's battery saver |
| Chrome emulation at 375 px, Android profile | Layout and touch at phone width, `context.setOffline(true)` journeys in Playwright | Any WebKit or iOS behavior, eviction, the camera |

No device in the matrix proves eviction or a real camera. Those stay covered by the design rules above, and by a real phone once one is available.

## Rejected alternatives

- **Server Actions for sync.** Faster to build for the web, but unversioned and unreachable for a native client.
- **Background Sync, or periodic sync in the service worker.** iOS has neither, so the design cannot depend on them.
- **Device time as truth without a window.** An old or skewed event would land in payroll without office review.
- **A multi-day assignment cache.** More offline reach, but more personal data on a possibly shared phone. Field research decides whether a later stage needs it.

## Revisit triggers

- Field research shows workers are offline for more than a day at a time: change the window values, not the design.
- Safari ships Background Sync, or Apple changes Home Screen web apps in the EU.
- The native client needs an operation the envelope cannot express.
