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

## Amendment 2026-11-09: late offline time events need the user's correction request

Decided by the E7 lead for werk-flow/werkflow-planning#317. The accepted text above stays as written; where it differs, this section wins.

- **Late events.** An offline time event that arrives more than 24 hours and at most 7 days after `capturedAt` is not recorded and creates no request. The server answers `conflict` with the code `correction_required`, not `correction_requested`. The device keeps the event visible and offers a `Zeitkorrektur` prefilled with the captured times. The person files it through the existing audited correction path, and the office decides it there.
- **Why.** That path establishes its caller from the cookie session, so a bearer request cannot reach it unchanged. A correction also proposes clock-in and clock-out pairs, and one late transition is half a pair.
- **Unchanged.** After 7 days the server refuses the event with `outside_recording_window`. A field sync kind for correction requests, which the native client needs, waits for V2.
- **Values fixed by #317.** The caller's organization is the active one, chosen as for every request: the organization cookie among the current memberships, otherwise the first. An operation naming another organization is `rejected` with `organization_mismatch`; a caller without a current membership gets `forbidden` for the whole request. The clock-skew tolerance is 5 minutes: a `capturedAt` later than that after receipt is `rejected` with `invalid`. A captured time before the person's last recorded event is `conflict` with `version_conflict`. A transition whose session needs the recovery decision answers `conflict` with `recovery_required`, also on every resend. The operation stores `capturedAt` and `sentAt`; its creation time is the receipt time. The three limits are named constants in the database function `transition_time_activity`.

## Amendment 2026-11-09: an offline time event is never recorded after its receipt

Decided by the E7 lead on the review of werk-flow/werkflow-planning#317.

- **Recorded time.** A `capturedAt` up to 5 minutes after receipt is recorded at the receipt time, because nothing happens after the server receives it. A later transition then never ends a segment before it started. The operation keeps the device's `capturedAt` and `sentAt`, and the window, the closed period and the order rule still check that `capturedAt`.
- **Blocked job.** A start or switch onto a job the office blocked meanwhile, by an open blocker or start dependency, answers `conflict` with `office_changed`, never `retry`.

## Amendment 2026-11-09: the today snapshot

Decided for werk-flow/werkflow-planning#318.

- **Read.** `GET /api/field-sync/v1/today` answers the caller's own scheduled job visits on the current Berlin day, limited to jobs the caller is assigned to, with the field facts of the work pack before work starts: schedule, customer and contact with phone, site with address and access, goal and instructions. Every field is named; nothing the online work pack hides from its assignee is in it. `lib/field-sync/today-snapshot.ts` owns the JSON shape.
- **Freshness.** The snapshot names its Berlin day and `validUntil`, the next Berlin midnight, so a device drops it by comparing instants and never computes a Berlin date. It carries a content `version`, also its `ETag`. A request whose `If-None-Match` names it gets `304`, and the device moves its „Stand“ to that time.
- **Organization.** An optional `organizationId` query value is a hint, refused with `organization_mismatch` when it is not the active organization, as for an operation.
- **Device.** The answer's outcome decides, never its status. A `rejected` answer with `forbidden` or `organization_mismatch` deletes the device's day: the person lost access. A `retry` answer, a `rejected` `invalid` answer (a fault of the client, not an access change) and a body that is no refusal keep it. The web device refreshes on the field worker's start page, where the app opens, and on `online`; a return to the visible app is the Realtime provider's catch-up for the page on screen, so the stored day can be older than that page. The „Stand“ says how old.

## Amendment 2026-11-10: a wipe that cannot finish

Decided for werk-flow/werkflow-planning#318.

- A wipe (sign-out, organization switch, a lost membership) deletes the database and signals every tab. The stored day names the wipe signal it was saved under, and every reader refuses a day saved before the latest one, so a deletion that fails or waits for another tab exposes nothing. A sign-out waits only until the browser reports the deletion done, failed or blocked by another tab, never for a blocked deletion to finish.
- Readers fail closed: a device that cannot read the wipe signal shows no stored day, and the page stays „Gerade kein Netz“.
- The wipe does not also empty the record before the delete. That second layer would protect only a browser without localStorage, which now shows nothing anyway, and it cost about 100 B of every cold start, because the wipe sits in a startup chunk.

## Amendment 2026-11-10: a sign-out never hangs on the wipe, and a lost claim ends the shown day

Decided for werk-flow/werkflow-planning#318.

- A sign-out waits at most 1.5 seconds for the deletion, because a deletion queued behind one another tab blocks reports nothing until that one ends. Readers already refuse the day by then.
- The wipe removes the device claim before it writes the signal, and a tab drops its shown day at either change. A signal that cannot be written, such as on a full quota, still ends the day in every tab.

## Amendment 2026-11-11: when a start page may claim the device

Decided for werk-flow/werkflow-planning#318.

- The start page takes the person and the active organization from the app's client state, not from its server props, so the clock actions' responses carry no ids.
- It claims the device only under the wipe signal it loaded with. Only an explicit organization switch in the same tab renews that signal, to the one its own wipe wrote before it shows the new organization. A person known only later, or an organization a membership fallback chose, keeps the old signal. Any other wipe since then, a sign-out's in another tab during the switch included, blocks the claim until the next start page.
- A start page that sees another tab's wipe signal, or another tab clearing all of localStorage (a `storage` event, which never fires for a tab's own writes), drops its claim at once and claims nothing more until the next start page, also when its refresh code finishes loading after the event. A refresh in flight then no longer owns the device, and no reader shows a day saved under the dropped claim. It never writes the wipe signal itself, so two tabs cannot answer each other's signal forever.
- A claim names its tab: `userId:organizationId:token`, with a random token per tab. Readers compare only the person and organization; a claim without a token, from a tab open across a deployment, matches no reader, and the next start page replaces it. A refresh still owns the device only while the claim carries its own token. A tab that drops its claim after another tab's wipe removes it only if it still carries its own token, so a claim another tab made meanwhile, and that tab's day, stay. The static wipe removes the claim whatever it holds.
- The page a person lands on after a session ends wipes the phone again. Every sign-out lands on an `(auth)` page once its session ended, so a day any tab saved while that session still answered is gone, whatever that tab does next.

## Amendment 2026-11-12: owner-accepted residual exposure

The owner accepted two residual exposures of the phone's stored day on 2026-11-12 (werk-flow/werkflow-planning#22). [Security](../technical/security.md#known-residual-exposure) lists them until they close.

- **Access that ends while the phone has no signal.** A person the office removes or suspends, or whose session expires, keeps reading their own assignments of the current Berlin day on a phone without signal. The day goes at the next Berlin midnight at the latest, and at once when the phone is online: the server's refusal deletes it, and an ended session lands on a login page, which wipes. The alternative is no reading without signal.
- **A sign-out that another tab races.** A start page stores the day in the milliseconds around another tab's sign-out and closes or freezes before it handles that tab's wipe signal, and the signing-out tab never reaches a login page, because it is closed first or its last sign-out request fails. Then the day of the person who signed out stays readable in that browser profile: customer and contact names and phone numbers, site addresses, access notes and instructions. It goes with the next wipe (any sign-out, any visit to a login page), with a start page of another person or organization, and at Berlin midnight. Closing it would need a session check on a read that must work without network.

## Amendment 2026-11-12: report drafts

Decided by the E7 lead for werk-flow/werkflow-planning#320. The owner accepted the lost-access rule and the seven-day limit on 2026-11-12 (werk-flow/werkflow-planning#22); each is one constant in `lib/field-sync/device/draft-store.ts`.

- **Kind.** `work_artifact.draft` carries a new Arbeitsnachweis of a job as its author's draft revision, with up to 20 photos. The device creates the ids of the Arbeitsnachweis, its revision and each photo link once. The envelope's `capturedAt` is when the person last changed the draft. `lib/work-artifacts/validation.ts` owns the payload.
- **Photos.** Each photo goes to storage through the document upload path first and becomes a document of the job. The operation names document ids, never bytes and never a storage key: the server derives every key itself. A photo must be an undeleted document of that job that the caller uploaded. The web device uploads through the document upload actions; an upload endpoint for the native client waits for V2.
- **One write.** One database function writes the revision and its photo links and records the operation with its hash and the device's clocks. A resend answers `replayed`, also after the person lost the job: the draft arrived, and the phone drops its copy. The same id with other content, or from another person, is `idempotency_conflict`. A revision the author already saved online under the draft's revision id, without photos, is adopted: the function records the operation and answers `replayed`.
- **A draft stays a draft.** The operation never submits. A review, a customer decision and a signature need the online paths. An Arbeitsnachweis that exists is never written over: `conflict` with `version_conflict`, or `office_changed` for a voided one.
- **Rechecks.** The handler establishes the membership, that the job belongs to the organization, and a field worker's assignment, before the function and again inside it. Each refusal is `rejected` with `forbidden`.
- **Author.** The payload names the draft's author. A session of another person answers `retry` with `unauthenticated`, and the draft waits for its author. A tab sends nothing after a sign-out or a sign-in page wrote the wipe signal, until a page names its person again, and that signal aborts a photo transfer in flight. Each photo's registration names the author too: `finalizeDocumentUpload` refuses another person's session with `uploader_changed` and registers nothing, and the draft waits.
- **Dialog code.** A field worker's job page loads the report dialog's code once the page is idle, so the first open without signal finds it. A load that fails stays silent until the next open, which loads again and shows the failure.
- **Device.** Drafts live in their own store, apart from the today snapshot, one record per draft with its person and organization. Every reader names both and gets nothing else. The static wipe never deletes a draft; sign-out and organization switch reach drafts through the unsent-work source. Text is stored as it is typed, a photo when it is taken. A write the device refuses, such as on a full disk, shows at the form.
- **Sending.** A draft is sent on app start, on `online` and on „Jetzt senden“ or „Erneut senden“. Only a draft that meets the rules of a saved draft goes by itself, and never while its dialog is open or a change made in it is still being written. The tabs of a phone send one after the other under one Web Lock. A draft is sealed only in the transaction that sees every photo uploaded; a photo another tab added meanwhile is uploaded first. Once the attach request has left, the draft no longer changes, an upload that ends later included, until an answer says the server holds nothing of it; an `organization_mismatch` is no such answer.
- **Lost access.** A `forbidden` answer, or a refused photo upload that the server's reader of the job's Arbeitsnachweise confirms, marks the draft „Kein Zugriff mehr“. It is never sent again. The person can delete it, and once 7 days have passed since the refusal, the phone deletes it on its next use, whoever uses it then; no code runs on an unused phone. Set to zero, the limit deletes it at once. The deletion runs whenever the draft code loads, for anyone: a field worker's job page loads it once idle, a page loads it when the phone may hold the person's drafts, and every page loads it at the dialog's first open. The sign-in page loads none of it, so a phone nobody opens a job on keeps such a draft until someone does.
- **Seven days.** A draft the person has not changed for 7 days is no longer sent by itself. It shows „Nicht übertragen“, goes when the person sends it again, and is deleted only when the person confirms the deletion.
- **Online save.** With signal and without photos, a new Arbeitsnachweis saves through its Server Action as before, under the draft's revision id, and the device's copy goes once every change is on the device. A save that gets no answer leaves the draft to the sync. If that save did land, the later attach finds that revision and answers `replayed`, and the server keeps one revision.

## Amendment 2026-11-12: where the lost-access deletion runs

Decided by the E7 lead for werk-flow/werkflow-planning#320. It replaces the last two sentences of the report drafts amendment's **Lost access** point.

- The deletion 7 days after a lost-access refusal no longer waits for a person who loads the draft code. A device mark (`werkflow:drafts-on-device` in localStorage, without a person) is set before the device stores any draft and removed once it holds none.
- The `(auth)` landing page and every job page read the mark. When it is set, they load the draft store lazily and delete every lost-access draft past its 7 days, of every holder. The sweep never sends, lists or changes a live draft. Every change of person on a shared phone passes the landing page, so a phone that only office users touch afterwards deletes it on its next use too.
- The draft code's send pass keeps running the same deletion.

## Amendment 2026-11-12: an online save seals the draft

Decided for werk-flow/werkflow-planning#320 after the Sol review. It adds to the report drafts amendment's **Online save** point.

- A draft without photos is sealed on the device before its online save leaves with the draft's revision id. A success removes the draft, and a refusal from the server unseals it. A save whose answer is lost leaves it sealed, so nothing changes the draft until the device's send of the same revision is answered. The attach adopts the author's own revision only for content that was never changed after that save. A save decides in one device transaction whether the draft goes online or with its own send, and the send seals only the state that save decided on: a draft another tab sealed or changed since is not sent from this form, and the form keeps its text.

## Amendment 2026-11-12: the draft marker of a revision

Decided by the E7 lead for werk-flow/werkflow-planning#320. It completes the **Online save** point: the server never relies on a client's behavior.

- `work_artifact_revisions.draft_changed_at` holds the device's last-change time of the draft a revision was written from. It is null for every revision not written from a device draft. The online save of a device draft writes it from the sealed draft, and the attach writes the envelope's `capturedAt` into it.
- The attach adopts a revision that already exists under the draft's revision id, and answers `replayed`, only when its author, organization, Arbeitsnachweis and `draft_changed_at` all match the draft it was sent. Any mismatch, a null included, answers `conflict` with `version_conflict`: the draft stays on the phone as „Nicht übertragen“, and nothing is overwritten.
- No client role reads the column: the server reads revisions with the service role, and the page's revision type leaves the column out.

## Amendment 2026-11-12: the time outbox

Decided for werk-flow/werkflow-planning#319. Where the accepted text above differs, this section wins.

- **Keeping an action.** A page whose signal is gone can load no code. So every page carries one static write: a clock start, switch or end that meets no network, or whose online call fails on its way, goes to localStorage with the time of the tap, the wipe signal of that moment, and the clock the server last confirmed with the time the page read it, already without job, customer and project names. The outbox code takes kept actions into IndexedDB when it next runs: at the app start, on `online`, on the page without signal and before a session ends. An online call writes its action down the same way before it starts, under its operation id, and removes it once the server answered; a take-in leaves that entry to its page while the page holds the call's Web Lock (two minutes without Web Locks), keeps every later action behind it, and takes it in once the page closed. An action leaves the kept list only after the outbox holds it. An action this version cannot read stays kept.
- **One chain.** One person's unsent events in one organization form a chain. They are sent in their order, one request per event, and the next one only after the server recorded the one before it. The first event expects the session and version the page read, unless the person's chain was settled after that read: then it expects what the chain's last answer named. Each later one expects what the answer before it named, and none after an end. Between sends an event keeps its operation id, captured time, organization and payload; only `sentAt` is new on each send.
- **A stopped chain.** A `rejected` or `conflict` answer, or 7 days without any answer, stops the chain at that event. Nothing behind it is sent. A page that shows the stopped chain refuses a new action that meets no network, because it would never be sent; an action a page kept before it could know waits behind the chain. The clock then shows the server's state, never the phone's. A refused event is sent again, unchanged, only when the person asks. A correction covers the chain's first session on its Berlin day, because the request records one clock-in and one clock-out: it opens prefilled with that day, start and end, and only that session's events leave the phone, after the request was filed. A deletion asks first and removes exactly the events it showed. What stays goes on from the clock the server confirmed. No answer deletes an event by itself.
- **An online call that reached the server.** The kept action carries the operation id of its online call. That call's hash holds no captured time, so the outbox's send of a recorded call meets the idempotency conflict; the conflict itself proves the id is recorded, also when the online call committed a moment before, so the server asks once more as the online call asked, and the ledger replays the first result at the online call's own time. A different action under the same id stays `idempotency_conflict`, and another organization's caller learns nothing of the first result.
- **Whose events.** The envelope names no person, so the device alone keeps one person's events out of another's session. A tab sends only for the person and organization its page was rendered for, and only while the browser's session is that person's, checked before every send. Another tab's wipe signal ends a tab's hold until it loads again, and a tap there then waits behind the person's events instead of going online. A tab learns of an action another tab kept and sends it. Two tabs acting within the same seconds can still send a later action before an earlier one whose online call is open; the server then refuses or conflicts the earlier event, the clock shows it, and the person files the audited correction or deletes it (the lead's decision). A sign-out asks only about the signed-in person's own events, in every organization. Another person's events stay on the phone, unsent and shown to nobody, until that person signs in there again.
- **No wipe.** The outbox sits in an IndexedDB database of its own, which the wipe never names. A sign-out and an organization switch first send, then name what is left and offer to send, to discard or to stay. They go on only when nothing is unsent. A check that cannot load or cannot read the device keeps the session and says so with a reload, because a tab left open across a deployment may hold code that is gone. „Verwerfen“ deletes only what the question named; work kept since then is asked about anew. From a sign-out's or switch's last check until its wipe, no tab keeps an action, so the check sees all the session leaves. A deletion waits for a send in flight; only in a browser without Web Locks, which no supported browser is, can it overlap another tab's send, and then the server's record wins and shows on the next refresh, changeable only through the audited correction. A device whose storage fails says so, and its clock actions go online while it has signal.
- **How long.** The owner accepted on 2026-11-12 (OQ-4, werk-flow/werkflow-planning#22): an unsent event counts as waiting for 7 days after its captured time, one device constant. After that it shows „Nicht übertragen“ and is deleted only when the person confirms it. The device still sends it on its triggers: the limit that decides is the server's.
- **What the phone holds.** For each event: its operation id, captured time, action, activity kind and job id, and the person and organization. For the chain: the clock the server last confirmed, without job, customer or project names. The page without signal therefore names a running job only as „Auftrag“.
- **The page without signal.** It knows no session, so it fails closed: it shows a clock only when exactly one was kept under the current wipe signal, and none after a sign-out, a switch or a visit to a login page. It captures and never sends; the app sends once it loads with signal and knows who is signed in.
- **Triggers.** The app start, `online`, „Jetzt senden“, and each kept action, which is tried at once because a phone can be wrong about having no network. A return to the visible app is no trigger: that listener belongs to the Realtime provider alone (client freshness contract rule 2). The runner's code loads at the app start only when a localStorage hint says the device may hold unsent work.

Every path that keeps, captures, takes in, sends, discards, corrects or ends a session holds these invariants:

1. **A tap.** Before any call, the action is on the device: in the static kept store under its operation id, marked in flight while its online call is open, until the server answered. A call that fails keeps that entry as the kept action; it is never removed and kept anew.
2. **New actions.** One check decides whether a page may keep a new action: its wipe signal is the shared one, and no session end is making its last check (`mayKeepUnder`). The static keep, the write before an online call and the page without signal ask it; a take-in of an action kept before does not. A tap goes online only when no kept action waits that the outbox has not taken in; otherwise it is kept behind it.
3. **Taking in.** Only the outbox code takes a kept action in, in tap order, one tab at a time. It leaves an in-flight entry to its page while the call's lock is held or the entry is younger than ten seconds (two minutes without Web Locks), keeps every later action behind it, and looks again by itself. An action this version cannot read is a stop too: nothing behind it is taken in or sent before it. One person's record the outbox cannot read fails closed for that person only. A key goes only after the outbox holds the action and the start-up hint is written. An id the outbox recorded is never taken in again.
4. **Sending.** One chain per person and organization, in order, one request per event, only for the tab's holder and under the verified session's token.
5. **A session end.** It counts every event of its scope in the outbox and every kept action behind an open online call, also one it cannot read, and fails closed when it cannot read the device: it asks, it never answers that nothing is unsent. Its question opens before any send, and „Abbrechen“ keeps the session while a send stalls. It puts up a barrier of its own before its check, renews it each minute while the flow runs, checks again when it finds the barrier lapsed, and lifts only that barrier on every exit; the wipe that ends a session lifts all. Whatever an ordering leaves on the phone after a session ended, the page a sign-out lands on says that unsent time waits, without names or times, until its person signs in and it is sent.
6. **A discard or deletion.** It removes exactly the ids its question showed when it opened, after a send in flight and after an open online call among them answered; anything newer stays and is asked about anew.
7. **A cleanup after a correction.** It deletes only what the form saw when it opened: that session's operation ids, on that day, and only for a request of the holder's own time. A session another tab settled or kept while the form was open stays.

## Amendment 2026-11-12: the time outbox after review

Decided for werk-flow/werkflow-planning#319 on its outside review. Where the amendment above differs, this section wins.

- **Keeping an action.** Each kept action has a localStorage key of its own, so two tabs never overwrite each other's action, and the outbox takes them in by the time of the tap. The time of the tap is taken before the online call, so a call that fails late changes no recorded time. A page keeps only under the wipe signal its person started with: after a sign-out or switch in another tab it keeps nothing more.
- **Unknown until checked.** When the device held unsent work at a page's start, every new action goes behind it until the outbox has shown what waits, also when the outbox cannot load without signal. No new action reaches the server before older ones.
- **Unreadable work.** A kept action this version cannot read stays kept, and the check before a session ends fails on it with its reload, instead of answering that nothing is unsent.
- **After the last answer.** When the last event of a chain was recorded, the outbox keeps that answer for an action a page kept behind the chain and the outbox takes in later.
- **An online call that reached the server.** `idempotency_conflict` for an event tried online first is never counted as recorded. Since the server replays the same action (the amendment above), the answer means a different action under the id: the chain stops as a conflict, and the person checks the clock, then deletes the kept events or files a correction.
- **Another organization.** An event for an organization that is not the active one, as after a switch in another tab, waits instead of failing; the server still refuses it under any other organization.
- **Whose events.** A session that cannot be read sends nothing. Another tab's wipe ends a tab's hold also while it reads the outbox. A page without a hold, such as the password reset, sends the session person's chains; the server accepts only the active organization's.

## Amendment 2026-11-12: what a sign-out and a switch ask about

Decided for werk-flow/werkflow-planning#319 on the lead's review.

- **Sign-out.** It ends the person's session in every organization, so it names the person's unsent events of every organization. „Jetzt senden“ sends only the active organization's; the server refuses the others there, and they stay waiting. „Verwerfen“ deletes the person's events of every organization after its confirmation. „Abbrechen“ deletes nothing and keeps the session; the person can switch to the other organization, whose page sends them.
- **Organization switch.** It leaves only the active organization, so it names and sends only that organization's events. „Verwerfen“ deletes only those. The other organizations' events stay untouched and are sent once the person works there.
- The question's seam takes the scope (`UnsentScope` in `lib/field-sync/device/unsent-work.ts`); a source that ignores it answers for the whole session, which asks more, never less.

## Amendment 2026-11-12: stored records and the stops they make

Decided for werk-flow/werkflow-planning#319 on its sixth review and the lead's decision on the stored format. It adds an eighth invariant to the time outbox's seven and sharpens the third and the fifth.

3. **Taking in**, sharpened. An action this version cannot read stops more than the take-in: nothing tapped after it is captured into the outbox or sent, and a new tap waits kept behind it.
5. **A session end**, sharpened. A flow that finds its barrier lapsed checks again even when a later renewal stood the barrier again: another tab may have kept an action while it lapsed.
8. **A stored record.** A record an earlier version wrote is always readable. Kept actions and outbox records have formats of their own with a `version`, not the live clock's type (`lib/field-sync/device/stored-clock.ts`). Reading ignores fields it does not know. A record of a newer version is a stop. A change that removes or reinterprets a field raises the version and adds a reader for the earlier one; `lib/field-sync/device/stored-records.test.ts` pins each version 1 record.

## Amendment 2026-11-12: a late chain of a session that still runs

Decided by the lead for werk-flow/werkflow-planning#319. A stopped chain whose events belong to a session the server still holds open offers no correction: an approved addition plus the later end of that session would count the time twice. The phone shows the captured times and the order that counts them once (note the times, delete them, end the running session through the clock, then file the correction), as a forgotten clock-out is settled today.

## Amendment 2026-11-13: the device test matrix, run

Recorded for werk-flow/werkflow-planning#321. The no-signal visit (flow `E7-F01`) ran by hand on the matrix's devices with a synthetic organization: today's assignment loaded with signal, signal lost, time recorded, a report saved on the device, a restart, the office changing the instruction and blocking the job's start, and the signal back. The browser group `audit:security:offline-visit` proves the same journey at 375 px in Chrome emulation.

| Device | Install | How "without signal" was made | Result |
| --- | --- | --- | --- |
| Android emulator, Chrome, Android 17 | "Add to Home screen", "Install": a launcher icon with a Chrome badge that opens standalone; no WebAPK was minted | Airplane mode plus removing the `adb reverse` forwards: airplane mode alone leaves `localhost` reachable through the adb tunnel | Pass: the offline pack and the offline clock after a restart, two photos from the emulated camera kept with the draft, with signal the recorded actions once at their captured times, the job switch as „Konflikt“ with the office's reason, the changed instruction, the report as one revision with two photos |
| iOS simulator, Safari, iOS 27.2 | "Add to Home Screen", opened from the Home Screen, signed in inside the web app | The local app server stopped: the simulator's airplane and Wi-Fi switches change only its status bar. This is "server gone, radio up", not real signal loss | Pass, except photos: the same states as on Android; the report arrived as one revision without photos |
| Mac Safari | — | — | Not run: no tool in the agent session drives the Mac's own Safari without acting in the owner's browser profile |

Differences from the matrix and the iOS limits table above:

- **The camera.** On the iOS simulator the photo input opened the system camera, which shows no picture and takes none; because the input asks for the camera, iOS offers no photo library. The matrix already lists the camera as unprovable there; the photo step stays proven by Android's emulated camera, the browser group and a real iPhone.
- **Offline through the host's network.** Neither device loses the app when the host or the device switches its network: Android reaches `localhost` through adb, and the iOS simulator through the Mac's loopback. A run cuts the tunnel (Android) or stops the server (iOS) instead.
- **Restart.** Android: a Chrome process restart, then the home screen icon. iOS: the driver cannot close a Home Screen web app, so the restart is the web app's own reload when it is opened again; it loaded the offline page from the service worker.
- **„Wartet auf Netz“ in the dock.** On iOS the dock showed the plain static mark: without the server the outbox view's code could not load. Android showed the badge. Both name the waiting state.
