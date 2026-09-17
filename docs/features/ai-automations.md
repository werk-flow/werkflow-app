# AI Automations

Status: living — last reviewed 2026-09-17

AI automations are WerkFlow's second product phase: assistants, recommendations, workflows, and bounded agents that use the complete operational context of the business to reduce repetitive work inside and outside the app.

They should be built after the relevant core workflow and data are trustworthy. AI cannot compensate for missing job states, ambiguous stock movements, incomplete permissions, or unreliable commercial records.

## Product Goal

WerkFlow should help an SHK business delegate repetitive information work while preserving human control over commitments, cost, legal records, customer communication, and employee data.

The long-term product should support:

- assistance inside a feature, such as extracting, summarizing, drafting, or recommending;
- product-owned automation templates for common SHK workflows;
- configurable workflows with triggers, conditions, approvals, and actions;
- bounded agents that perform multi-step work against authorized WerkFlow context;
- authorized actions in external systems such as email, SMS, calendars, accounting tools, suppliers, or customer portals;
- cross-domain analysis of project, service, workforce, financial, and inventory history.

An AI capability belongs only when it clearly reduces paperwork, improves organization, or saves time without making the business less able to understand and control its operations.

The owner's direction, recorded on 2026-09-17: one agent, built on a WerkFlow-owned harness, integrated into the whole app and able to do most of what an office user can do, with a name of its own. "WerkFlow AI" is the placeholder until the product name is chosen. The full input, in the owner's structure, is kept in [pre-Wave-3 step 4](../plans/phase-1/pre-wave-3/04-wave-3-4-and-phase-2-planning.md#owner-input-of-2026-09-17-phase-2-vision-and-phase-1-implications); the plan below is what the owner and the agent decided from it the same day, and the considerations list at the end keeps every point that is not yet a decision.

## Current Product Baseline

There is no AI automation module. No model provider, agent framework, workflow engine, vector or search architecture, messaging provider, integration platform, automation builder, or usage model is chosen in code; the decisions below are planning decisions, not implemented behavior.

The Phase 1 foundations that exist today and that the plan builds on:

- The shared attention pattern on `/aufgaben` ([P1-07](../plans/phase-1/slices/p1-07-attention-pattern.md)): one role-aware task, approval and notification surface derived live from the owning domains, with stable source identities and viewer-scoped authorization. Every AI confirmation joins it.
- Eleven append-only event ledgers guarded by `guard_event_ledger_history` (migration `20260907010100`): requests, follow-ups, communication preferences, documents, employee records, responsibilities, qualifications, sickness, teams, vacation, attention. The inventory ledgers join in `P1-27`.
- Organization scoping through RLS on every table and app-layer authorization in every Server Action ([security.md](../technical/security.md)), which is the boundary every tool the agent may call inherits.
- The background-read registry (`lib/data/background-reads.ts`, a closed set of read kinds behind one authorized route) as the pattern for read-only tool access.
- File bytes on R2 behind organization-prefixed signed URLs ([document-storage-and-access.md](../technical/document-storage-and-access.md)), which is how a model reads a document without the bytes passing through the app.
- Transactional email through Resend (EU sending region) for invitations and account mail; no inbound email, SMS, phone, calendar, accounting or wholesaler connector exists.

## Phase 1 — Complete Operational Core Enabling Foundations

AI is a Phase 2 product capability, but the complete operational core must deliberately provide its foundations.

### Reliable Domain Events

The product should expose understandable business events such as:

- customer request received;
- offer prepared, approved, declined, or expired;
- job created, assigned, started, blocked, completed, or reopened;
- maintenance due or overdue;
- appointment scheduled, changed, or canceled;
- time correction requested or approved;
- document uploaded or structured record accepted;
- material planned, reserved, ordered, received, consumed, returned, or below threshold;
- invoice prepared, sent, due, paid, disputed, or overdue;
- customer approval or signature received.

An automation must react to the business event, not infer it from an unrelated UI action. `P1-53` turns the per-domain ledgers into one inventory of events and validated actions; until then each domain's ledger is the source.

### Safe Product Actions

Every action an automation may eventually perform should already have:

- organization and role validation;
- clear input and result;
- idempotent or duplicate-safe behavior where repetition is possible;
- visible validation errors;
- audit history;
- preview or draft state when it creates a commitment;
- cancellation, correction, or compensating action where practical;
- an owner when execution fails.

### Seams the remaining Phase 1 slices add (owner decision 2026-09-17)

Three Wave 3 and Wave 4 slices add one column or one read model each so that the Phase 2 features land on data instead of on a redesign: `P1-36` stores a source per offer line (catalog, manual, later "AI proposal"); `P1-30` records a delivery note's file hash and supplier note number for the duplicate check; `P1-17`'s customer-safe handover package becomes data a page renderer can read. None of them adds Phase 2 behavior.

### Shared Approval And Attention Model

WerkFlow needs one understandable way to present:

- a draft requiring review;
- an approval request;
- an automation blocked on missing information;
- a failed external action;
- a warning or recommendation;
- a completed action and its result.

Each feature should not invent a separate AI inbox. Automation work should enter the same role-aware task, approval, and notification experience as human work. The shared `/aufgaben` view derives actionable items from their owning domains through `lib/attention/`; `lib/attention/types.ts` owns the source-type vocabulary. Phase 2 review items join this experience with explicit authorization and failure ownership.

### Integration And Identity Boundaries

Before external automation, the product must define:

- which organization connected the service;
- which user or service identity performs the action;
- available scopes and data;
- credential ownership and revocation;
- environment and recipient restrictions;
- rate and usage limits;
- delivery, retry, duplicate, and failure behavior;
- audit and retention;
- what happens when the connector is removed.

### Data Quality And Source Visibility

AI outputs should retain:

- the source records and documents used;
- the time the source was read;
- the relevant organization and permission context;
- uncertainty or missing information;
- the generated proposal and later human edits;
- the accepted final result.

The user should be able to distinguish source fact, model inference, and human decision.

## Phase 2 — Intelligence And Automation

### Level 1: Assist

Low-friction assistance inside existing workflows:

- structured extraction from invoices, delivery notes, offers, contracts, reports, and forms;
- classification and linking suggestions;
- summaries of customer, job, project, service, inventory, or financial history;
- speech and notes into report, offer, or request drafts;
- German rewriting and translation while preserving original text;
- offer, invoice description, email, SMS, checklist, or follow-up drafts;
- retrieval of relevant procedures, manuals, documents, or prior work, over the OCR and full-text foundation of `P1-44` once it exists.

Assistive output should remain a draft or suggestion. It must not silently become a business record.

### Level 2: Recommend

Use connected data to identify actionable options:

- jobs at risk because of missing people, material, approval, or time;
- likely unbilled time or material;
- reorder and demand proposals;
- duplicate or unusual supplier invoices;
- margin, cash, overdue-payment, and stock anomalies;
- service systems with recurring faults;
- scheduling and route alternatives;
- missing project documentation;
- expiring employee certifications or maintenance commitments;
- likely next steps for a customer or completed job.

Recommendations should show supporting records and should not present correlation as a certain diagnosis.

### Level 3: Product-Owned Automation Templates

WerkFlow should first offer understandable templates for common outcomes:

- after a job is completed and approved, prepare a customer summary for email or SMS;
- after customer signature, create the office follow-up and invoice draft;
- when stock falls below a threshold, prepare a supplier order proposal;
- when maintenance approaches, create draft work and a customer contact task;
- when an invoice becomes overdue, prepare the correct reminder step;
- when a delivery note is uploaded, extract it and propose the matching purchase order and receipt;
- when a field report is incomplete, request the missing evidence before final completion;
- when a project reaches a checkpoint, prepare a summary, risk list, or document pack;
- after a completed project, generate the customer handover page;
- before the next working day, prepare office and field briefs.

Templates state their trigger, conditions, data, actions, approval points, recipients, and failure behavior in plain German.

### Level 4: Configurable Workflows

Authorized users may later compose:

- triggers from WerkFlow or connected systems;
- conditions using structured business state;
- data retrieval and transformation steps;
- draft generation or analysis;
- human approvals;
- WerkFlow actions;
- email, SMS, calendar, accounting, supplier, or other connector actions;
- delays, schedules, retries, and escalation;
- success and failure notifications.

The builder begins from safe templates and constrained choices, and it is gated on `P1-53`. Asking the agent in chat to create a workflow produces a draft template the user reviews (trigger, permissions, data, cost, recipients, actions) before activation; the result appears in a workflows view as a diagram of steps. The outside effects of any workflow are limited to email from an admin-configured sender address and SMS or WhatsApp from an admin-configured number, both delivered through `P1-46`; no workflow connects to a user's own mailbox, calendar application or file system (owner decision 2026-09-17).

### Level 5: Bounded Agents

A bounded agent may perform multi-step, goal-directed work such as:

- start at a project checkpoint, inspect approved project context, produce a status summary, identify missing artifacts, and propose follow-up tasks;
- audit the prior quarter's inventory, purchasing, outgoing invoices, incoming bills, job consumption, and margins, then prepare an evidence-linked assessment for the next quarter;
- prepare a service renewal review across due contracts, unresolved defects, capacity, and material demand;
- assemble a customer handover pack and draft the external communication;
- reconcile selected operational records and produce an exception list for an office user;
- analyze the last months of finances and report patterns and the most valuable customers, or propose a better restock cycle.

An agent must have:

- a bounded objective and allowed data;
- an explicit set of permitted tools and actions;
- organization and role context;
- time, token, money, and external-action limits;
- required approval checkpoints;
- an execution log and source references;
- cancellation and timeout behavior;
- a human owner for exceptions;
- a clear distinction between proposed and completed actions.

"Autonomous" must never mean unbounded access to the organization.

## The Phase 2 Plan (decided 2026-09-17)

### The pilot lane after Wave 4

The roadmap forbids Phase 2 implementation before `P1-54`, with one exception the owner decided on 2026-09-17: after Wave 4 a bounded pilot lane opens for two Level 1 assist slices on accepted domains, with no external action. The first is a voice note into an `Arbeitsbericht` draft: the field worker records, the model drafts the report into a new `P1-15` revision in draft state, the worker edits and saves (needs a speech provider and the model, nothing else). The second is the daily brief: one German summary per office user and per field worker from the plan, the dispatches, the blockers and the open approvals, delivered inside `/aufgaben`. The lane proves the provider contract, the AVV, the run ledger and the review UX on low-risk data while Wave 5 runs. An `Anfrage` draft from an inbound email is the third candidate and waits for the inbound-email decision.

### Surfaces

Task-embedded generation with a review step comes first: an offer draft in the positions editor, the delivery-note review modal on `Inventar`, the handover page generation with a checklist. The global chat page with threads is the second slice, once the tool layer covers enough actions; a popover is not built (a panel beside a record is the chat page in a narrower frame). Both share one harness, so the chat invokes the same task tools and shows the same review surfaces. Every peer that generates content lands it in an existing draft object and uses the product's ordinary save or send as the commit; WerkFlow does the same and never adds a separate approval interface.

### Write authority

Reads run unattended within the caller's role. Every state-changing action the agent proposes (create a job, invite an employee, book stock, draft a message) becomes a confirmation, inline in the thread or as an `/aufgaben` item, before it executes, with an audit row either way. No organization-level setting can disable confirmation for external or financial actions.

### Model and harness

The harness is model-agnostic through the Vercel AI SDK (version 7, Node 22, ESM) from day one. The default for defined tasks and chat is GPT-5.6 Luna at medium reasoning on OpenAI's EU endpoint (about ten times cheaper than the alternatives at the same task, zero retention in region); Claude Sonnet 5 through the Bedrock `eu.` inference profile in Frankfurt is the quality reference and fallback; Haiku 4.5 or Luna runs the injection screens. A German trade-prose evaluation set is built before the first slice ships, and it decides the default, not the price table. Anthropic's first-party API offers no EU inference, so customer data never goes to it directly ([decision 0001 amendment](../decisions/0001-infrastructure-stack.md)).

### Memory

Three small markdown documents per organization, stored as text rows in Postgres under RLS: company facts (about 1,500 tokens), standing rules and corrections, and one document per member with preferences only (about 500 tokens), plus on-demand topic notes read by title. The agent writes through one tool with add, replace and remove on a named document; a write that exceeds the cap fails, which forces consolidation. Every version is kept, so a bad write is one click to revert. `admin` and `buero` get a memory page to read, edit and delete, and a review queue for writes the agent proposes; field workers cannot write organization memory. Customer personal data never enters memory; the agent reads customers from the CRM tables. Deleting a member deletes their document through the offboarding flow; deleting an organization deletes everything. Memory is loaded as labelled untrusted content, never inside the system prompt, and every proposed write runs through the injection screen. No self-directed consolidation pass and no vector memory in Phase 2.

### Dictation

Every prompt input offers dictation. Wispr Flow is not integrable on WerkFlow's terms (a gated enterprise API, US-only processing, no browser client), so WerkFlow builds its own: streaming speech to text on an EU endpoint (AssemblyAI or Deepgram; a field test with real Handwerker audio decides) plus one small-model pass that fixes punctuation and applies spoken self-corrections. Users who own Wispr Flow keep using it as their keyboard. The original recording is kept as evidence for reports.

### Document intelligence

Embedded e-invoice XML (`factur-x.xml`, `zugferd-invoice.xml`, `xrechnung.xml`) is parsed first, deterministically. For paper and photo documents, Azure Document Intelligence in Germany West Central (prebuilt invoice, German fields and handwriting) is the first provider; a model second pass handles delivery notes, offers and site notes. Extracted values stay untrusted until a person reviews them; the original file stays.

### Delivery-note intake

The feature the beta users asked for: a dedicated button on `Inventar` uploads a `Lieferschein`, the model recognizes lines and quantities and matches catalog items, a review modal shows the list with a duplicate check on file hash and supplier note number, and only the corrected, confirmed lines become a `P1-30` receipt. The chat agent invokes the same tool and shows the same modal. The flow is the tool; the chat is a second entrance.

### Handover pages

A generated customer page for a completed project, served at `<org>.werk-flow.app/uebergabe/<token>` on one wildcard domain: 128-bit tokens, per-package expiry and revocation, an optional password, no search indexing, an access log per open, deletion with the job's retention. The page shows the `P1-17` customer-safe package (photos, documents, offers, appointments) and never internal notes or times; a checklist before generation and inline or prompt edits after it. Customer-owned subdomains through a CNAME come later, on request, because each adds a DNS support case per tenant.

### Channels and connectors

Each connector names ownership, direction, credential, retry, deduplication, revocation and fallback before it ships. The decided starting points: inbound email on a WerkFlow address per organization (Amazon SES in `eu-central-1` or Mailgun EU); a customer mailbox connection later through Microsoft Graph (free publisher verification) before Google (annual CASA assessment); calendar as an ICS subscription first, then Microsoft Graph; SMS through a German provider with a phone-number sender so customers can reply; WhatsApp last (template approval, opt-in, German data localization, per-message charges from October 2026); phone intake, if built rather than partnered, through call forwarding to one WerkFlow-owned national number on Twilio with Ireland routing or sipgate plus an EU realtime voice API, because per-customer German numbers need a business register document and an address inside the prefix each time. Accounting and wholesaler connectors are Wave 4 and Wave 3 scope (`P1-43`, `P1-34`, `P1-50`); an agent never places a supplier order or issues an invoice.

### Guardrails: given by the stack, built in Phase 2

Given: organization scoping and RLS, the attention pattern for confirmations, the guarded ledgers, organization-prefixed signed URLs, the background-read registry as the read-tool pattern, Postgres transactions for idempotent actions.

Built: an automation run ledger (trigger, inputs read with timestamps, proposal, approval, action, result, cost); a per-organization budget with hard stops and spend tracking from day one; an execution identity distinct from the user who configured a workflow; a tool allow-list per role, template and agent, derived from the caller's role and RLS, with no raw SQL or HTTP tool; idempotency keys for every external action; retry and terminal failure states; a kill switch per organization and per workflow; prompt and output retention rules; PII minimization before provider calls; a poisoned-document and poisoned-memory suite in the test catalog. Staying on task is architecture, not a vendor: the system prompt scopes the job and carries one German refusal sentence for everything else, untrusted content (PDFs, OCR text, emails, memory) enters only as labelled tool results that never override the system prompt or the user's request, a small-model classifier screens uploads and memory writes at about a fifth of a cent per document, refusals are logged per user and repeat offenders are throttled. Dedicated guardrail vendors stay out until a measured gap appears.

### Cost and the offer

AI is bundled into the subscription, not metered; the worked month for a 15-person business costs 2 to 4 % of the price at the expensive model. The offer states one fair-use line in the customer's units ("bis zu 300 KI-Vorgänge im Monat", one Vorgang being one Angebot, one Übergabe, one Lieferschein or ten Chat-Antworten), the app shows a plain counter, top-ups exist only above the line in the same unit, dictation is capped separately in minutes only if it grows, and tokens, credits or per-outcome charges are never exposed. Details in [offer.md](../product/offer.md).

### Data dependencies

| Capability (level) | Needs from Phase 1 | Available today | Missing until |
| --- | --- | --- | --- |
| Voice or photo note into an `Arbeitsbericht` draft (L1) | `P1-15` artifacts and revisions, `P1-16` work pack, R2 signed URLs | yes | speech provider (pilot lane) |
| Email or phone request into an `Anfrage` draft (L1) | `P1-02` requests, `P1-01` customer matching, `P1-10` timeline | yes | inbound email or phone provider |
| Customer, job or equipment history summary (L1) | `P1-10`, `P1-14`, `P1-15`, `P1-18` to `P1-20` | yes | nothing |
| Delivery note into inventory review (L1, L3) | `P1-25` catalog, `P1-30` receipts, `P1-41` matching | Wave 3 and 4 | `P1-30`, document intelligence |
| Offer draft from dictation, photos and a price list (L1) | `P1-35`, `P1-36` | Wave 4 | `P1-36` |
| Every other recurring document (L1) | the owning Wave 4 slice | Wave 4 | that slice |
| Jobs at risk, unbilled time and material (L2) | `P1-14`, `P1-23`, `P1-27`, `P1-38` | partly | `P1-27`, `P1-38` |
| Reorder proposals (L2) | `P1-25`, `P1-26`, `P1-29` | no | `P1-29` |
| Scheduling proposals as ghost cards on the Plantafel (L2) | `P1-11`, `P1-12`, `P1-24a` | after `P1-24a` | `P1-50` for route proposals |
| Missing-evidence reminder before completion (L3) | `P1-14` gates, `P1-15`, `P1-07` | yes | nothing |
| Handover page after completion (L1, L3) | `P1-17` package as data, `P1-46` for delivery | `P1-17` seam | hosting path, `P1-46` |
| Overdue-invoice reminder step (L3) | `P1-39`, `P1-42` | Wave 4 | `P1-42` |
| Daily office and field brief (L3) | `P1-11`, `P1-12`, `P1-14`, `P1-21` | yes | nothing (pilot lane) |
| Configurable workflows (L4) | `P1-53` event and action inventory | no | `P1-53` |
| Quarter audit and renewal review agents (L5) | Waves 3 and 4 plus `P1-53` | no | `P1-53` |

### Considerations recorded from the owner's input (2026-09-17)

Kept here so they are revisited when Phase 2 is planned slice by slice, even where the decision above went another way; the full text is in the [step 4 record](../plans/phase-1/pre-wave-3/04-wave-3-4-and-phase-2-planning.md#owner-input-of-2026-09-17-phase-2-vision-and-phase-1-implications):

1. The agent as a user of its own, able to do nearly everything an office user can, with a system prompt WerkFlow owns and access to all business data through the same authorization as a person; a humanoid product name.
2. A dedicated chat page like Codex or Claude Code with threads beside the sidebar; a popover; or task buttons only; the owner leans to the chat because people prefer chat to forms. Decided: tasks first, chat page second, no popover.
3. AI offer creation from dictation or text with the assumptions shown, opened for correction; the same for invoices, contracts, receipts and handover documents. Decided: drafts into the positions editor, never a PDF editor.
4. Handover as a generated web page on the customer's own subdomain with a generated password, a checklist before and inline or prompt edits after. Decided: WerkFlow subdomain first, customer domain later.
5. Memory files per organization, task-specific and person-specific, learned from corrections, with "Hermes Agent" as the comparable project. Decided: three capped documents in Postgres with review and versioning.
6. Wispr Flow as the dictation layer everywhere and the question of a free tier for beta users. Finding: not integrable; own EU pipeline instead.
7. Task allowances or a token budget in the offer, and how to state either so a buyer understands it. Decided: bundled with one fair-use line in customer units.
8. Whether documents should be manually creatable at all, how AI-generated PDFs are edited, and OCR that reads handwriting. Decided: structured editor for manual and AI creation; handwriting through the document-intelligence provider.
9. The delivery-note intake as a dedicated button with a review modal versus a chat request with a duplicate check. Decided: both entrances, one tool, always the modal.
10. Jailbreaks and staying on task. Decided: the layered guardrails above.
11. Scheduled and multi-step workflows inside the app, created by stringing steps together or by asking the agent, shown as a node diagram, with outside effects limited to admin-configured email and SMS or WhatsApp senders. Decided: templates first, builder after `P1-53`.
12. DSGVO and the e-invoice law as hard constraints; `gflohr/e-invoice-eu` as a candidate library. Decided: the provider table above and the Wave 4 engine.
13. Nothing here is a promise of scope; every point stays documented until Phase 2 is planned in detail.

## In-App And External Automation

The location of the result does not define the risk. A hidden in-app stock change can be more consequential than a draft email.

### In-App Examples

- create a draft task or checklist from a project milestone;
- summarize field notes into a report draft;
- suggest document links or categories;
- create an exception list from finance or inventory history;
- prepare a schedule or reorder proposal;
- detect missing approvals or completion evidence.

### External Examples

- send an approved customer email or SMS;
- create or update an authorized external calendar entry;
- submit an approved supplier order through a supported interface;
- transfer reviewed records to an accounting system;
- receive customer requests through email, forms, or a portal;
- deliver a signed report, invoice, handover pack, or review link.

External actions need delivery status and external identifiers so WerkFlow can show what actually happened.

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

Every feature remains the owner of its business rules. The automation layer orchestrates authorized actions; it does not bypass the feature's validation.

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

The organization may configure narrower permissions. It cannot weaken non-negotiable security, tenant, or legal safeguards, and it cannot switch off confirmation for external or financial actions.

## Role And UX Principles

- Ordinary users benefit from automation without understanding prompts, models, or workflow graphs.
- Field workers see short, contextual requests and drafts, not an automation control center.
- Office users see the exact source, proposed change, recipient, and downstream effect; sources sit next to the claim they support, styled apart from the body text, one click from the passage.
- Admins control connections, permissions, budgets, policies, memory, and published workflows.
- Natural-language setup produces a transparent configuration, never a hidden instruction.
- German UI copy distinguishes `Vorschlag`, `Entwurf`, `wartet auf Freigabe`, `ausgeführt`, and `fehlgeschlagen`; every AI-created document is labelled as AI-drafted until a person confirms it.
- AI does not create constant low-value notifications or reduce confidence in ordinary product behavior.
- Every automation has an owner, description, status, last run, next run or trigger, and visible history.

## Trust, Security, And Operational Requirements

### Permission And Tenant Safety

- Never retrieve or act outside the active organization.
- Evaluate permissions at execution time, not only when a workflow is created.
- Separate the creator, approver, connection owner, and execution identity.
- Revoke or pause workflows when required access disappears.

### Privacy And Data Use

- Identify model and connector data processors before release: one `Auftragsverarbeitungsvertrag` per provider, a published sub-processor list in German, training excluded by contract, retention pinned (30 days or zero retention), a `Datenschutz-Folgenabschätzung` before customer or employee data flows, SCCs plus a transfer impact assessment for any US-parented provider.
- Define retention for prompts, files, outputs, traces, and provider logs; keep traces in EU-hosted tooling under WerkFlow's own rules.
- Avoid using organization data for model training without explicit, valid agreement.
- Minimize employee, customer, financial, and document data sent to a provider.
- Provide deletion and export behavior consistent with the source record.

### Reliability

- Use duplicate-safe actions and external idempotency where available.
- Make retry state and terminal failure visible.
- Prevent retry storms and repeated customer or supplier actions.
- Pause workflows when a dependency is unhealthy or configuration becomes invalid.
- Preserve the last safe state and provide a manual recovery path.

### Cost And Abuse Control

- Set organization and workflow usage limits with hard stops.
- Estimate or cap expensive runs where practical.
- Restrict bulk communication and external actions.
- Detect loops and runaway fan-out.
- Show usage at a level the buyer understands, in the offer's units.

### Evaluation And Quality

- Test on real, permission-safe SHK examples and edge cases; the German trade-prose evaluation set precedes the first slice.
- Evaluate factual extraction separately from writing quality.
- Track acceptance, correction, failure, and harmful-action rates.
- Re-evaluate after model, prompt, tool, or workflow changes.
- Never use fluent output as the only quality signal.

## Boundaries And Decision Gates

- A generic workflow canvas is not the first AI feature.
- Agents do not operate across every organization object by default.
- Automatic supplier orders, final invoices, payments, employment decisions, destructive actions, and legal communications require strong controls.
- AI does not diagnose equipment faults or provide legal, tax, or safety conclusions as established fact.
- Customer-facing bots and autonomous phone handling need an explicit handoff, disclosure, recording, and escalation policy; the phone assistant is a partner-or-build decision with thin margins at low volume and belongs after the in-app assists.
- Cross-organization benchmarking requires valid consent, anonymization, and a separate product decision.
- Model-provider, hosting, and data-residency decisions must be made before sensitive workloads. The hosting boundary ([decision 0001](../decisions/0001-infrastructure-stack.md), amended 2026-09-17): provider APIs with EU processing, no self-hosted models or GPU infrastructure; long-running automation runtimes run as durable functions or Railway workers; workflow state, approvals, budgets, and audit stay in Postgres.
- AI usage is bundled into the subscription; the offer, not this document, states the fair-use line.

## Open Product Decisions

- The product name of the agent.
- Which speech provider the German field test selects, and whether a Wispr Flow enterprise agreement ever becomes worth pursuing.
- Whether GPT-5.6 Luna passes the German trade-prose evaluation or Sonnet 5 becomes the default.
- Which durable-execution engine runs the templates (Vercel Workflows in an EU region or pgmq in Supabase with cron).
- Which inbound-email provider hosts the per-organization intake address, and when a customer mailbox connection is worth the verification programs.
- Whether the phone assistant is partnered or built, and on which telephony path.
- Which external accounting, calendar, supplier, and messaging systems are priorities beyond the decided starting points.
- How workflow ownership transfers when an employee leaves.
- How a workflow version change affects in-flight runs.
- What execution history and source material different roles see.
- The exact fair-use line and top-up price in the offer.
- When a recommendation requires professional domain validation.
- Whether custom workflows are limited to admins or allow delegated automation managers.
- Which conditions must be met before bounded agents can perform external actions.

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, the pilot lane after Wave 4, and links to per-slice acceptance records.
- [Pre-Wave-3 step 4](../plans/phase-1/pre-wave-3/04-wave-3-4-and-phase-2-planning.md) — the research digests, the owner's input in full, and the reasoning behind every decision in this spec.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
- [Decision 0001 — infrastructure stack](../decisions/0001-infrastructure-stack.md) — Phase 2 AI hosting via provider APIs, amended 2026-09-17.
- [Product offer](../product/offer.md) — the bundled AI allowance.
