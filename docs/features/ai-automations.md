# AI Automations

Status: living — last reviewed 2026-10-05

AI automations are WerkFlow's second product phase: assistants, recommendations, workflows and bounded agents that use the operational context of the business to reduce repetitive work inside and outside the app.

Build them after the relevant core workflow and its data are trustworthy. AI cannot compensate for missing job states, ambiguous stock movements, incomplete permissions or unreliable commercial records.

## Product Goal

WerkFlow helps an SHK business delegate repetitive information work. People keep control over commitments, cost, legal records, customer communication and employee data.

The long-term product supports:

- assistance inside a feature: extract, summarize, draft, recommend;
- product-owned automation templates for common SHK workflows;
- configurable workflows with triggers, conditions, approvals and actions;
- bounded agents that perform multi-step work against authorized WerkFlow context;
- authorized actions in external systems such as email, SMS, calendars, accounting tools, suppliers or customer portals;
- cross-domain analysis of project, service, workforce, financial and inventory history.

An AI capability belongs only when it reduces paperwork, improves organization or saves time, and the business can still understand and control its operations.

The owner's direction is one agent, built on a harness that WerkFlow owns. The agent is integrated into the whole app and can do most of what an office user can do. It reads business data through the same authorization as a person. It gets a name of its own. "WerkFlow AI" is the placeholder until the product name is chosen.

Nothing in this spec is a promise of scope. Every point stays here until Phase 2 is planned slice by slice.

## Current Product Baseline

There is no AI automation module. No model provider, agent framework, workflow engine, search architecture, messaging provider, integration platform, automation builder or usage model exists in the product. The decisions below are planning decisions.

Phase 1 already provides these foundations:

- One role-aware list of tasks, approvals and notifications on `/aufgaben`, derived live from the owning domains. Every AI confirmation joins it.
- An append-only event history per domain.
- Organization scoping and role authorization on every read and every action ([security.md](../technical/security.md)). Every tool the agent may call inherits this boundary.
- A closed set of authorized background reads, which is the pattern for read-only tool access.
- File bytes behind organization-scoped signed URLs ([document-storage-and-access.md](../technical/document-storage-and-access.md)). A model can read a document without the bytes passing through the app.
- Transactional email for invitations and account mail, sent from an EU region. No inbound email, SMS, phone, calendar, accounting or wholesaler connector exists.

## Phase 1 — Complete Operational Core Enabling Foundations

AI is a Phase 2 capability, but the operational core must provide its foundations on purpose.

### Reliable Domain Events

The product exposes business events that a person understands:

- customer request received;
- offer prepared, approved, declined or expired;
- job created, assigned, started, blocked, completed or reopened;
- maintenance due or overdue;
- appointment scheduled, changed or canceled;
- time correction requested or approved;
- document uploaded or structured record accepted;
- material planned, reserved, ordered, received, consumed, returned or below threshold;
- invoice prepared, sent, due, paid, disputed or overdue;
- customer approval or signature received.

An automation reacts to the business event. It does not infer the event from an unrelated UI action. `P1-53` turns the per-domain event histories into one inventory of events and validated actions. Until then each domain's history is the source.

### Safe Product Actions

Every action an automation may perform has:

- organization and role validation;
- a clear input and result;
- duplicate-safe behavior where repetition is possible;
- visible validation errors;
- audit history;
- a preview or draft state when it creates a commitment;
- cancellation, correction or a compensating action where practical;
- an owner when execution fails.

### Seams the remaining Phase 1 slices add

Two slices each add one small seam, so that Phase 2 features land on data and need no redesign. Neither adds Phase 2 behavior.

- `P1-36` stores a source per offer line: catalog, manual, later "AI proposal".
- `P1-30` records a delivery note's file hash and supplier note number for the duplicate check.

`P1-17` already keeps each handover release as structured snapshots beside its rendered file, so a page renderer can read the customer-safe package as data.

### Shared Approval And Attention Model

WerkFlow presents all of these in one way:

- a draft that needs review;
- an approval request;
- an automation blocked on missing information;
- a failed external action;
- a warning or recommendation;
- a completed action and its result.

No feature invents a separate AI inbox. Automation work enters the same task, approval and notification list as human work, with explicit authorization and a named owner for failures.

### Integration And Identity Boundaries

Before any external automation, the product defines:

- which organization connected the service;
- which user or service identity performs the action;
- available scopes and data;
- credential ownership and revocation;
- environment and recipient restrictions;
- rate and usage limits;
- delivery, retry, duplicate and failure behavior;
- audit and retention;
- what happens when the connector is removed.

### Data Quality And Source Visibility

An AI output retains:

- the source records and documents it used;
- the time each source was read;
- the organization and permission context;
- uncertainty or missing information;
- the generated proposal and later human edits;
- the accepted final result.

The user can tell source fact, model inference and human decision apart.

## Phase 2 — Intelligence And Automation

### Level 1: Assist

Assistance inside existing workflows:

- structured extraction from invoices, delivery notes, offers, contracts, reports and forms;
- classification and linking suggestions;
- summaries of customer, job, project, service, inventory or financial history;
- speech and notes into report, offer or request drafts;
- German rewriting and translation that preserves the original text;
- drafts of offers, invoice descriptions, emails, SMS, checklists and follow-ups;
- retrieval of relevant procedures, manuals, documents or prior work, over the OCR and full-text foundation of `P1-44`.

Assistive output stays a draft or suggestion. It never becomes a business record silently.

### Level 2: Recommend

Connected data identifies actionable options:

- jobs at risk because of missing people, material, approval or time;
- likely unbilled time or material;
- reorder and demand proposals;
- duplicate or unusual supplier invoices;
- margin, cash, overdue-payment and stock anomalies;
- service systems with recurring faults;
- scheduling and route alternatives;
- missing project documentation;
- expiring employee certifications or maintenance commitments;
- likely next steps for a customer or a completed job.

A recommendation shows its supporting records. It does not present a correlation as a certain diagnosis.

### Level 3: Product-Owned Automation Templates

WerkFlow first offers templates for common outcomes:

- after a job is completed and approved, prepare a customer summary for email or SMS;
- after a customer signature, create the office follow-up and the invoice draft;
- when stock falls below a threshold, prepare a supplier order proposal;
- when maintenance approaches, create draft work and a customer contact task;
- when an invoice becomes overdue, prepare the correct reminder step;
- when a delivery note is uploaded, extract it and propose the matching purchase order and receipt;
- when a field report is incomplete, request the missing evidence before final completion;
- when a project reaches a checkpoint, prepare a summary, a risk list or a document pack;
- after a completed project, generate the customer handover page;
- before the next working day, prepare office and field briefs.

A template states its trigger, conditions, data, actions, approval points, recipients and failure behavior in plain German.

### Level 4: Configurable Workflows

Authorized users may later compose:

- triggers from WerkFlow or connected systems;
- conditions on structured business state;
- data retrieval and transformation steps;
- draft generation or analysis;
- human approvals;
- WerkFlow actions;
- email, SMS, calendar, accounting, supplier or other connector actions;
- delays, schedules, retries and escalation;
- success and failure notifications.

The builder starts from safe templates and constrained choices. It is gated on `P1-53`. When a user asks the agent in chat to create a workflow, the agent produces a draft template. The user reviews trigger, permissions, data, cost, recipients and actions before activation. The result appears in a workflows view as a diagram of steps.

Owner decision: the outside effects of any workflow are limited to email from an admin-configured sender address and SMS or WhatsApp from an admin-configured number, both delivered through `P1-46`. No workflow connects to a user's own mailbox, calendar application or file system.

### Level 5: Bounded Agents

A bounded agent may perform multi-step, goal-directed work such as:

- at a project checkpoint, inspect the approved project context, produce a status summary, identify missing artifacts and propose follow-up tasks;
- audit the prior quarter's inventory, purchasing, outgoing invoices, incoming bills, job consumption and margins, then prepare an evidence-linked assessment for the next quarter;
- prepare a service renewal review across due contracts, unresolved defects, capacity and material demand;
- assemble a customer handover pack and draft the external communication;
- reconcile selected operational records and produce an exception list for an office user;
- analyze recent finances, report patterns and the most valuable customers, or propose a better restock cycle.

An agent has:

- a bounded objective and allowed data;
- an explicit set of permitted tools and actions;
- organization and role context;
- time, token, money and external-action limits;
- required approval checkpoints;
- an execution log and source references;
- cancellation and timeout behavior;
- a human owner for exceptions;
- a clear distinction between proposed and completed actions.

"Autonomous" never means unbounded access to the organization.

## The Phase 2 Plan

### The pilot lane after Wave 4

The roadmap forbids Phase 2 implementation before `P1-54`, with one exception the owner decided. After Wave 4 a bounded pilot lane opens for two Level 1 assist slices on accepted domains, with no external action.

1. A voice note becomes an `Arbeitsbericht` draft. The field worker records, the model drafts the report into a new `P1-15` revision in draft state, and the worker edits and saves. This slice needs a speech provider and the model, nothing else.
2. The daily brief. Each office user and each field worker gets one German summary of the plan, the dispatches, the blockers and the open approvals, delivered inside `/aufgaben`.

The lane proves the provider contract, the AVV, the run ledger and the review experience on low-risk data while Wave 5 runs. An `Anfrage` draft from an inbound email is the third candidate. It waits for the inbound-email decision.

### Surfaces

Task-embedded generation with a review step comes first: an offer draft in the positions editor, the delivery-note review modal on `Inventar`, the handover page generation with a checklist. The global chat page with threads is the second slice, once the tool layer covers enough actions. WerkFlow builds no popover. A panel beside a record is the chat page in a narrower frame.

Both surfaces share one harness, so the chat invokes the same task tools and shows the same review steps. Generated content lands in an existing draft object, and the product's ordinary save or send is the commit. WerkFlow never adds a separate approval interface.

Documents get a structured editor for manual and for AI creation. An AI draft goes into the positions editor, never into a PDF editor.

### The chat workspace: direction and required study

This subsection records the owner's direction for the global chat. It is not planned scope. A deep study and a decision record come before any slice.

**The direction.** The chat is a full AI workspace in the form people know from ChatGPT and claude.ai, leaning towards a chat product and away from a code editor:

- every user has their own threads in a sidebar;
- the composer offers attachments and dictation, and possibly a model picker and a reasoning-effort setting;
- an answer streams in and shows what the agent does while it works: reasoning, tool calls, calls to outside services and the confirmations it asks for;
- a reload or a second device picks up a running answer where it is.

The quality bar is T3 Chat and T3 Code by Ping Labs: moving between threads never waits for the server, a long answer never stalls the page, and nothing is lost on a reload. The performance rules of [realtime and caching](../technical/realtime-and-caching.md) apply to the chat as to every other surface. The chat adds measured scenarios of its own: the client's share of send to first token, a thread switch, the frame budget while an answer streams, and resume after a reload.

**What a first reading of the T3 Code source showed.** T3 Code is open source (`github.com/pingdotgg/t3code`, read at commit `3e6b450`). It is single-user software for one machine, with no tenant, role or row-level model, so its code does not carry over. Its patterns do:

1. One ordered list of typed turn items is the only render model: user message, assistant message, reasoning, each kind of tool call, approval request, plan, notice and error. Each item carries a streaming flag or a status. Reasoning and tool calls are items of their own, not fields of a message.
2. The conversation is an append-only event log with a rising sequence number per thread. The screen reads projections of it. A command is acknowledged when its intent is committed, and side effects run afterwards from an outbox, each with an idempotent command id.
3. Resume is a snapshot plus a cursor. The client keeps the snapshot and the last sequence number and drops duplicates. After a reconnect the server replays a small gap or sends a fresh snapshot.
4. The thread list is a separate, light stream of summaries with deltas. It does not depend on thread detail.
5. Opening a thread loads a bounded number of recent rows, pages older history on demand and leaves heavy tool output on the server until someone opens it.
6. The server merges updates in a short window, keeps only the latest unfinished update per tool call, never drops a final update and gives each subscription a budget in items and bytes.
7. Streamed text is parsed incrementally. A finished block is never parsed again, and code highlighting waits until its block is complete.
8. The timeline is virtualized and has named scroll states: following the end, anchoring a new turn at the top, and free scrolling while the user reads.
9. Models and their options are data. Reasoning effort is one option descriptor among others, a provider states its capabilities as flags, and a failure has a class, a retry flag and a reset time.
10. The composer keeps a draft per thread across reloads, starts an upload when a file is attached, and is replaced by the approval or question while one is pending, so that it cannot scroll out of view.

Two of its engineering habits fit WerkFlow's testing rules: payload budgets are pinned as tests, and server tests replay recorded provider transcripts and never wait on a timer.

**What public sources report about T3 Chat.** T3 Chat is closed source. The following comes from posts, talks and third-party summaries and is not verified:

- It began local-first, with threads in the browser's database and navigation on the client. It moved its data and sync layer to Convex when users with thousands of threads became slow.
- A streamed token re-renders only the message it belongs to, and a new thread appears before the server answers.
- Its longest outage came from live queries over a search index and from reconnects without backoff. Both are warnings for any design with live subscriptions over large lists.

**Lessons from a public performance overhaul of a chat product.** Anthropic described how it made claude.ai about three times faster, and Theo Browne of Ping Labs published a critical walk-through of that account. Both are input for the chat's design. The chat adopts these points as starting rules, each to be confirmed by measurement in its slice:

- A new thread is saved before the screen moves to it. A reload one second after sending must not lose it.
- A cached thread list may paint at once, but it is checked against the server on every load and after every change in another session. A thread deleted elsewhere disappears, and opening it never ends in an error. Content that is not yet confirmed is shown as unconfirmed, for example dimmed.
- Text streams in finished blocks: a paragraph, a list item, a code block, a table. A half-written code block or table is not shown, and there is no word-by-word fade.
- Syntax highlighting and other heavy parsing run off the main thread and never block typing or scrolling. A highlighted block fades in when it is ready.
- The composer stays mounted when the thread changes, and hovering a thread starts loading it.
- A long thread opens as fast as a short one, because the first load is bounded.
- A measurement covers what the user feels: from the action to the usable result. A count of renders or requests is a tool for finding waste and never a reason to remove a read that keeps the screen current.

**The data store is an open decision.** The owner's working assumption is that the operational core stays on Postgres and that the chat's threads, messages and streams may fit Convex better, which would give the product two databases that must work together. [Decision 0001](../decisions/0001-infrastructure-stack.md) settles the stack, so this needs a superseding decision record before anything is built. That record weighs at least:

- **What stays in Postgres either way.** The run ledger, approvals, budgets, audit rows, memory and every business record a tool reads or writes stay under RLS, as this spec already requires.
- **Identity and the tenant boundary in a second store.** Supabase Auth sessions would have to be accepted there, and organization and role checks would exist a second time, without RLS.
- **Consistency between two stores.** A confirmation shown in a thread and the business write it releases must not drift apart. This needs idempotency keys and an outbox on one side.
- **Privacy.** A second store is a new sub-processor with its own `Auftragsverarbeitungsvertrag`, its own EU region, and its own retention, export and deletion paths per organization and per member.
- **Operations and cost.** Reconnect backoff, live queries over large lists, pricing at the expected message volume, the React Native client and the way out if the provider changes terms.
- **The alternative to measure against.** T3 Code reaches its quality on SQLite with an event log, so a sync engine is one way to get there and not a precondition. The comparison case is Postgres tables with a sequence number per thread, delivered through the existing Realtime transport or a streamed response.
- **Where the agent loop runs.** A run outlives a request. The record names the durable runtime and how a client that reconnects in the middle of a run catches up.

The decision is made on a spike of both options against the same measured scenarios, not on preference.

**Study required before the plan.**

- Read T3 Code in depth for the points above: the event store and its sequence numbers under concurrent writers, the resume decision, optimistic send and its failure cases, approvals as durable objects, the attachment pipeline, the rules for what leaves the server, and the scroll and streaming-render code with its tests. Find the measurement behind each of its numeric budgets before adopting a number.
- Verify the T3 Chat points from primary sources, and use the product hands-on to record its interaction details: thread list, model picker, retry and branching, search, keyboard shortcuts, sharing.
- Check the T3 Code license before reusing anything beyond ideas.
- Translate the result into WerkFlow's terms: organization scoping on every row and every subscription, confirmations that also appear on `/aufgaben`, German copy, and the component registry.

### Write authority

Reads run unattended within the caller's role. Every state-changing action the agent proposes becomes a confirmation before it executes. Examples are creating a job, inviting an employee, booking stock and drafting a message. The confirmation appears inline in the thread or as an `/aufgaben` item. An audit row records the outcome either way. No organization-level setting can disable confirmation for external or financial actions.

### Model and harness

The harness is model-agnostic through the Vercel AI SDK from the first slice.

- The default for defined tasks and chat is GPT-5.6 Luna at medium reasoning on OpenAI's EU endpoint. It costs about a tenth of the alternatives for the same task and offers zero retention in region.
- Claude Sonnet 5 through the Bedrock `eu.` inference profile in Frankfurt is the quality reference and the fallback.
- Haiku 4.5 or Luna runs the injection screens.

A German trade-prose evaluation set is built before the first slice ships. The evaluation decides the default. The price table does not. Anthropic's first-party API offers no EU inference, so customer data never goes to it directly ([decision 0001 amendment](../decisions/0001-infrastructure-stack.md)).

### Memory

Memory is a few small markdown documents per organization, stored as text in Postgres under RLS:

- company facts, about 1,500 tokens;
- standing rules and corrections;
- one document per member with preferences only, about 500 tokens;
- topic notes that the agent reads on demand by title.

Rules:

- The agent writes through one tool with add, replace and remove on a named document. A write that exceeds the cap fails, which forces consolidation.
- Every version is kept, so a bad write takes one click to revert.
- `admin` and `buero` get a memory page to read, edit and delete, and a review queue for writes the agent proposes. Field workers cannot write organization memory.
- Customer personal data never enters memory. The agent reads customers from the CRM.
- Offboarding a member deletes their document. Deleting an organization deletes everything.
- Memory is loaded as labelled untrusted content, never inside the system prompt. Every proposed write runs through the injection screen.
- Phase 2 has no self-directed consolidation pass and no vector memory.

### Dictation

Every prompt input offers dictation. Wispr Flow cannot be integrated on WerkFlow's terms: its API is a gated enterprise API, processing is US-only and there is no browser client. WerkFlow builds its own pipeline: streaming speech to text on an EU endpoint, then one small-model pass that fixes punctuation and applies spoken self-corrections. The candidates are AssemblyAI and Deepgram, and a field test with real Handwerker audio decides. Users who own Wispr Flow keep using it as their keyboard. The original recording is kept as evidence for reports.

### Document intelligence

Embedded e-invoice XML (`factur-x.xml`, `zugferd-invoice.xml`, `xrechnung.xml`) is parsed first, deterministically. For paper and photo documents, Azure Document Intelligence in Germany West Central is the first provider, with its prebuilt invoice model, German fields and handwriting. A model second pass handles delivery notes, offers and site notes. Extracted values stay untrusted until a person reviews them. The original file stays.

DSGVO and the German e-invoice law are hard constraints. `gflohr/e-invoice-eu` is a candidate library for the Wave 4 e-invoice engine.

### Delivery-note intake

The beta users asked for this feature. A dedicated button on `Inventar` uploads a `Lieferschein`. The model recognizes lines and quantities and matches catalog items. A review modal shows the list with a duplicate check on file hash and supplier note number. Only the corrected, confirmed lines become a `P1-30` receipt. The chat agent invokes the same tool and shows the same modal. The flow is the tool, and the chat is a second entrance.

### Handover pages

WerkFlow generates a customer page for a completed project and serves it at `<org>.werk-flow.app/uebergabe/<token>` on one wildcard domain.

- Protection: 128-bit tokens, expiry and revocation per package, an optional password, no search indexing, an access log per open, deletion with the job's retention.
- Content: the `P1-17` customer-safe package of photos, documents, offers and appointments. The page never shows internal notes or times.
- Editing: a checklist before generation, inline or prompt edits after it.
- Customer-owned subdomains through a CNAME come later, on request, because each adds a DNS support case per tenant.

### Channels and connectors

Each connector names ownership, direction, credential, retry, deduplication, revocation and fallback before it ships. The decided starting points:

- **Inbound email.** A WerkFlow address per organization, on Amazon SES in `eu-central-1` or Mailgun EU.
- **Customer mailbox connection.** Later, and Microsoft Graph before Google. Microsoft's publisher verification is free. Google requires an annual CASA assessment.
- **Calendar.** An ICS subscription first, then Microsoft Graph.
- **SMS.** seven.io, a German provider, with a phone-number sender so that customers can reply. Alphanumeric senders are send-only in Germany.
- **WhatsApp.** Last, through the Meta Cloud API via a BSP such as 360dialog with `data_localization_region` DE. It brings template approval, opt-in and per-message charges.
- **Phone intake.** If WerkFlow builds it and does not partner, calls forward to one WerkFlow-owned national number on Twilio with Ireland routing or on sipgate, plus an EU realtime voice API. A German number per customer needs a business register document and an address inside the prefix each time.
- **Accounting and wholesalers.** These connectors are Phase 1 scope (`P1-43`, `P1-34`, `P1-50`). An agent never places a supplier order and never issues an invoice.

### Guardrails: given by the stack, built in Phase 2

The stack gives the foundations listed in the Current Product Baseline, plus Postgres transactions for idempotent actions.

Phase 2 builds:

- an automation run ledger: trigger, inputs read with timestamps, proposal, approval, action, result, cost;
- a budget per organization with hard stops and spend tracking from the first slice;
- an execution identity distinct from the user who configured a workflow;
- a tool allow-list per role, template and agent, derived from the caller's role and RLS, with no raw SQL tool and no HTTP tool;
- idempotency keys for every external action;
- retry and terminal failure states;
- a kill switch per organization and per workflow;
- prompt and output retention rules;
- PII minimization before provider calls;
- a poisoned-document and poisoned-memory suite in the test catalog.

Staying on task is architecture, not a vendor product:

- The system prompt scopes the job and carries one German refusal sentence for everything else.
- Untrusted content (PDFs, OCR text, emails, memory) enters only as labelled tool results. It never overrides the system prompt or the user's request.
- A small-model classifier screens uploads and memory writes.
- Refusals are logged per user, and repeat offenders are throttled.
- Dedicated guardrail vendors stay out until a measured gap appears.

Tooling candidates, pending the owner's decision:

- Observability and evaluation through Langfuse Cloud in the EU, plus promptfoo for offline evaluation. Prompt and trace retention follows WerkFlow's own rules.
- Retrieval in Postgres with pgvector, combined with full-text search through reciprocal rank fusion. The same RLS rows scope it to the organization. SHK scale needs no separate vector store.
- Embeddings from Cohere Embed v4 on Bedrock Frankfurt or from Mistral EU.

### Cost and the offer

The [business offer](../../../werkflow-business/docs/offer.md#price-and-payment-direction) owns included AI use, optional extra usage and unresolved allowances. The product direction is AI use bundled into the subscription, with a visible allowance in units a customer understands and one fair-use line. The product exposes no tokens and no credits. No figure from a planning scenario is an entitlement or a price guarantee. Define and validate the actual allowance before implementation or sale.

### Data dependencies

| Capability (level) | Needs from Phase 1 | Missing until |
| --- | --- | --- |
| Voice or photo note into an `Arbeitsbericht` draft (L1) | `P1-15` artifacts and revisions, `P1-16` work pack, signed file URLs | speech provider (pilot lane) |
| Email or phone request into an `Anfrage` draft (L1) | `P1-02` requests, `P1-01` customer matching, `P1-10` timeline | inbound email or phone provider |
| Customer, job or equipment history summary (L1) | `P1-10`, `P1-14`, `P1-15`, `P1-18` to `P1-20` | nothing |
| Delivery note into inventory review (L1, L3) | `P1-25` catalog, `P1-30` receipts, `P1-41` matching | `P1-30`, document intelligence |
| Offer draft from dictation, photos and a price list (L1) | `P1-35`, `P1-36` | `P1-36` |
| Every other recurring document (L1) | the owning Wave 4 slice | that slice |
| Jobs at risk, unbilled time and material (L2) | `P1-14`, `P1-23`, `P1-27`, `P1-38` | `P1-27`, `P1-38` |
| Reorder proposals (L2) | `P1-25`, `P1-26`, `P1-29` | `P1-29` |
| Scheduling proposals as ghost cards on the Plantafel (L2) | `P1-11`, `P1-12`, `P1-24a` | `P1-50` for route proposals |
| Missing-evidence reminder before completion (L3) | `P1-14` gates, `P1-15`, `P1-07` | nothing |
| Handover page after completion (L1, L3) | `P1-17` package as data, `P1-46` for delivery | hosting path, `P1-46` |
| Overdue-invoice reminder step (L3) | `P1-39`, `P1-42` | `P1-42` |
| Daily office and field brief (L3) | `P1-11`, `P1-12`, `P1-14`, `P1-21` | nothing (pilot lane) |
| Configurable workflows (L4) | `P1-53` event and action inventory | `P1-53` |
| Quarter audit and renewal review agents (L5) | Waves 3 and 4 plus `P1-53` | `P1-53` |

### How Phase 2 gets planned

Phase 1 continues in the order of its [roadmap](../plans/phase-1/roadmap.md). Phase 2 is then planned the way Phase 1 was: a `docs/plans/phase-2/` roadmap with waves, bounded slices, gates and records. It is built from three inputs: this spec, the "Phase 2 — Intelligence And Automation" section of every feature spec, and the five levels of the [capability map](../product/product-capability-map.md). Beta feedback reorders slices inside a wave. It does not skip a wave's prerequisites. The pilot lane is the one Phase 2 delivery inside Phase 1, and its two slices are the first records under `docs/plans/phase-2/`.

Phase 2 planning settles these prerequisites first. None of them is a feature.

- **The contract chain.** WerkFlow is its customers' processor. A model provider, a speech provider and a document-intelligence provider are new sub-processors. The requirements under "Privacy And Data Use" below apply before the first customer document reaches a model. This legal work has a lead time and belongs to the offer and onboarding, not to a slice.
- **The execution identity.** An agent acts under an identity that is neither the user nor the service role. The membership and responsibility model needs a service principal with its own audit attribution. `P1-53` owns it. The auth re-evaluation of [decision 0001](../decisions/0001-infrastructure-stack.md), before mobile sessions and external identities, is the moment to design it.
- **The evaluation set.** Real, consented SHK documents and dictations from the beta customer, anonymized where possible, for German offer prose, delivery notes and site notes. Without the set the model choice is a guess.
- **Observability.** An error and trace pipeline for the app that the AI run ledger and the EU trace store join. A failed run is then an incident with an owner, not a silent retry.
- **The product name of the agent**, decided before any user-facing copy exists.
- **The usage counter and the fair-use line in the offer**, so that the first pilot slice ships with the counter visible.

## In-App And External Automation

The location of the result does not define the risk. A hidden in-app stock change can be more consequential than a draft email.

External actions need a delivery status and external identifiers, so that WerkFlow can show what happened.

## Connected Workflow Contracts

| Feature area | Useful intelligence | Potential approved actions |
| --- | --- | --- |
| Customers and CRM | Intake extraction, history summary, duplicate suggestions, next action | Draft and send communication, create request or follow-up |
| Jobs and projects | Scope structuring, status summary, risk and missing-artifact detection | Draft tasks, checklists, reports, handover packs and pages |
| Service and maintenance | History brief, report drafting, recurring-fault and demand analysis | Prepare service request, follow-up, maintenance work |
| Calendar | Conflict, route, capacity, and rescheduling proposals | Apply an approved schedule change and notifications |
| Employees and time | Missing-entry, balance, workload, qualification, and anomaly signals | Prepare correction, approval, or training and renewal task |
| Documents | OCR, extraction, classification, linking, comparison, and summary | Accept reviewed metadata or create a structured draft |
| Inventory and purchasing | Demand, shortage, discrepancy, reorder, receipt and invoice match, delivery-note intake | Prepare or submit an approved purchase action; a confirmed receipt |
| Commercial and finance | Offer and invoice drafting, incoming-bill extraction, anomaly and margin analysis | Create reviewed commercial drafts, reminders, exports |

Every feature remains the owner of its business rules. The automation layer orchestrates authorized actions. It does not bypass the feature's validation.

## Human-Control Levels

Use risk-based defaults:

| Control level | Example | Default behavior |
| --- | --- | --- |
| Inform | Summary, search answer, non-binding warning | Show source and allow dismissal |
| Suggest | Category, link, schedule option, reorder quantity | User explicitly accepts |
| Draft | Report, offer, invoice, email, order, handover page | Editable draft; responsible user approves |
| Execute reversible internal action | Create task, apply tag, schedule internal reminder | May run automatically when configured; audit and undo or stop |
| Execute external or costly action | Send message, change customer appointment, place order | Explicit approval or tightly scoped organization policy |
| Legally or financially sensitive action | Finalize invoice, payment, contract, payroll or time decision, deletion | Strong authorization and normally explicit human approval |

The organization may configure narrower permissions. It cannot weaken security, tenant or legal safeguards.

## Role And UX Principles

- Ordinary users benefit from automation without understanding prompts, models or workflow graphs.
- Field workers see short, contextual requests and drafts, not an automation control center.
- Office users see the exact source, proposed change, recipient and downstream effect. A source sits next to the claim it supports, styled apart from the body text, one click from the passage.
- Admins control connections, permissions, budgets, policies, memory and published workflows.
- Natural-language setup produces a transparent configuration, never a hidden instruction.
- German UI copy distinguishes `Vorschlag`, `Entwurf`, `wartet auf Freigabe`, `ausgeführt` and `fehlgeschlagen`. Every AI-created document is labelled as AI-drafted until a person confirms it.
- AI does not create constant low-value notifications or reduce confidence in ordinary product behavior.
- Every automation has an owner, description, status, last run, next run or trigger, and visible history.

## Trust, Security, And Operational Requirements

### Permission And Tenant Safety

- Never retrieve or act outside the active organization.
- Evaluate permissions at execution time, not only when a workflow is created.
- Separate the creator, the approver, the connection owner and the execution identity.
- Revoke or pause a workflow when its required access disappears.

### Privacy And Data Use

- Identify model and connector data processors before release. Each provider needs an `Auftragsverarbeitungsvertrag`, training excluded by contract and pinned retention of 30 days or zero. A US-parented provider also needs SCCs and a transfer impact assessment.
- Update the `Auftragsverarbeitungsvertrag` with each customer and publish a sub-processor list in German.
- Complete a `Datenschutz-Folgenabschätzung` before customer or employee data flows to a provider.
- Define retention for prompts, files, outputs, traces and provider logs. Keep traces in EU-hosted tooling under WerkFlow's own rules.
- Do not use organization data for model training without explicit, valid agreement.
- Minimize the employee, customer, financial and document data sent to a provider.
- Provide deletion and export behavior consistent with the source record.

### Reliability

- Prevent retry storms and repeated customer or supplier actions.
- Pause a workflow when a dependency is unhealthy or its configuration becomes invalid.
- Preserve the last safe state and provide a manual recovery path.

### Cost And Abuse Control

- Estimate or cap expensive runs where practical.
- Restrict bulk communication and external actions.
- Detect loops and runaway fan-out.
- Show usage at a level the buyer understands, in the offer's units.

### Evaluation And Quality

- Test on real, permission-safe SHK examples and edge cases.
- Evaluate factual extraction separately from writing quality.
- Track acceptance, correction, failure and harmful-action rates.
- Re-evaluate after a model, prompt, tool or workflow change.
- Never use fluent output as the only quality signal.

## Boundaries And Decision Gates

- A generic workflow canvas is not the first AI feature.
- Agents do not operate across every organization object by default.
- Automatic supplier orders, final invoices, payments, employment decisions, destructive actions and legal communications require strong controls.
- AI does not diagnose equipment faults and does not present legal, tax or safety conclusions as established fact.
- Customer-facing bots and autonomous phone handling need an explicit handoff, disclosure, recording and escalation policy. The phone assistant is a partner-or-build decision with thin margins at low volume. It belongs after the in-app assists.
- Cross-organization benchmarking requires valid consent, anonymization and a separate product decision.
- Model-provider, hosting and data-residency decisions come before sensitive workloads. [Decision 0001](../decisions/0001-infrastructure-stack.md) sets the hosting boundary: provider APIs with EU processing, no self-hosted models and no GPU infrastructure. Long-running automation runtimes run as durable functions or Railway workers. Workflow state, approvals, budgets and audit stay in Postgres.

## Open Product Decisions

- The product name of the agent.
- Where the chat's threads, messages and streams live: Postgres alone, or a second store such as Convex beside it (see "The chat workspace: direction and required study").
- Whether users choose the model and the reasoning effort in the composer, and what that means for cost and the fair-use line.
- Which speech provider the German field test selects, and whether a Wispr Flow enterprise agreement ever becomes worth pursuing.
- Whether GPT-5.6 Luna passes the German trade-prose evaluation or Sonnet 5 becomes the default.
- Which durable-execution engine runs the templates: Vercel Workflows in an EU region, or pgmq in Supabase with cron.
- Which inbound-email provider hosts the per-organization intake address, and when a customer mailbox connection is worth the verification programs.
- Whether the phone assistant is partnered or built, and on which telephony path.
- Which external accounting, calendar, supplier and messaging systems are priorities beyond the decided starting points.
- How workflow ownership transfers when an employee leaves.
- How a workflow version change affects in-flight runs.
- What execution history and source material different roles see.
- The exact fair-use line and top-up price in the offer.
- When a recommendation requires professional domain validation.
- Whether custom workflows are limited to admins or allow delegated automation managers.
- Which conditions must be met before bounded agents can perform external actions.
