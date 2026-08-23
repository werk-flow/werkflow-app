# AI Automations

Status: living — last reviewed 2026-08-24

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

## Current Product Baseline

There is no confirmed AI automation module yet.

Do not assume a specific:

- model provider;
- agent framework;
- workflow engine;
- vector/search architecture;
- messaging provider;
- integration platform;
- automation builder UI;
- pricing or usage model.

Current feature work should create reliable business events, permissions, auditability, review states, and structured records that later automation can safely use.

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

An automation must react to the business event, not infer it from an unrelated UI action.

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

### Shared Approval And Attention Model

WerkFlow needs one understandable way to present:

- a draft requiring review;
- an approval request;
- an automation blocked on missing information;
- a failed external action;
- a warning or recommendation;
- a completed action and its result.

Each feature should not invent a separate AI inbox. Automation work should enter the same role-aware task, approval, and notification experience as human work.

**Current baseline (`P1-07`, 2026-08-07; taxonomy extended by `P1-08`, 2026-08-08):** this shared experience now exists for human work. Attention items are derived live by one server-side resolver (`lib/attention/`) from the owning domains — pending time sessions/change requests, pending vacation requests, open client requests, and since `P1-08` sickness-report notices (the first two-audience, privacy-scoped notification type: managers and the affected person, with version-keyed re-surfacing on corrections) — discriminated by a stable `source_type` + `source_id` identity, deduplicated per viewer, authorization-scoped through the P1-05 responsibility resolution at derivation time, and surfaced role-aware at `/aufgaben` with deep links into the owning context. Decision notifications for the affected person, strictly personal read markers, and an append-only pattern audit are the only stored pattern state. Phase 2 automation items (drafts requiring review, blocked automations, failed external actions, recommendations) are expected to enter this pattern as new `source_type`s with their own derivation — never as a parallel inbox or a materialized task table.

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

- OCR and document search;
- structured extraction from invoices, delivery notes, offers, contracts, reports, and forms;
- classification and linking suggestions;
- summaries of customer, job, project, service, inventory, or financial history;
- speech/notes-to-report drafting;
- German rewriting and translation while preserving original text;
- offer, invoice description, email, SMS, checklist, or follow-up drafts;
- retrieval of relevant procedures, manuals, documents, or prior work.

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
- when a delivery note is uploaded, extract it and propose the matching purchase order/receipt;
- when a field report is incomplete, request the missing evidence before final completion;
- when a project reaches a checkpoint, prepare a summary, risk list, or document pack;
- after successful work and a configured delay, prepare a review-link message;
- before the next working day, prepare office and field briefs.

Templates should state their trigger, conditions, data, actions, approval points, recipients, and failure behavior in plain German.

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

The builder should begin from safe templates and constrained choices. Natural-language creation may generate a draft workflow, but users must review the exact trigger, permissions, data, cost, recipients, and actions before activation.

### Level 5: Bounded Agents

A bounded agent may perform multi-step, goal-directed work such as:

- start at a project checkpoint, inspect approved project context, produce a status summary, identify missing artifacts, and propose follow-up tasks;
- audit the prior quarter's inventory, purchasing, outgoing invoices, incoming bills, job consumption, and margins, then prepare an evidence-linked assessment for the next quarter;
- prepare a service renewal review across due contracts, unresolved defects, capacity, and material demand;
- assemble a customer handover pack and draft the external communication;
- reconcile selected operational records and produce an exception list for an office user.

An agent must have:

- a bounded objective and allowed data;
- an explicit set of permitted tools/actions;
- organization and role context;
- time, token, money, and external-action limits;
- required approval checkpoints;
- an execution log and source references;
- cancellation and timeout behavior;
- a human owner for exceptions;
- a clear distinction between proposed and completed actions.

“Autonomous” must never mean unbounded access to the organization.

## In-App And External Automation

The location of the result does not define the risk. A hidden in-app stock change can be more consequential than a draft email.

### In-App Examples

- create a draft task/checklist from a project milestone;
- summarize field notes into a report draft;
- suggest document links or categories;
- create an exception list from finance/inventory history;
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
| Customers and CRM | Intake extraction, history summary, duplicate suggestions, next action | Draft/send communication, create request or follow-up |
| Jobs and projects | Scope structuring, status summary, risk and missing-artifact detection | Draft tasks, checklists, reports, handover packs |
| Service and maintenance | History brief, report drafting, recurring-fault and demand analysis | Prepare service request, follow-up, maintenance work |
| Calendar | Conflict, route, capacity, and rescheduling proposals | Apply an approved schedule change and notifications |
| Employees and time | Missing-entry, balance, workload, qualification, and anomaly signals | Prepare correction, approval, or training/renewal task |
| Documents | OCR, extraction, classification, linking, comparison, and summary | Accept reviewed metadata or create a structured draft |
| Inventory and purchasing | Demand, shortage, discrepancy, reorder, receipt/invoice match | Prepare or submit an approved purchase action |
| Commercial and finance | Offer/invoice drafting, incoming-bill extraction, anomaly and margin analysis | Create reviewed commercial drafts, reminders, exports |

Every feature remains the owner of its business rules. The automation layer orchestrates authorized actions; it does not bypass the feature's validation.

## Human-Control Levels

Use risk-based defaults:

| Control level | Example | Default behavior |
| --- | --- | --- |
| Inform | Summary, search answer, non-binding warning | Show source and allow dismissal |
| Suggest | Category, link, schedule option, reorder quantity | User explicitly accepts |
| Draft | Report, offer, invoice, email, order | Editable draft; responsible user approves |
| Execute reversible internal action | Create task, apply tag, schedule internal reminder | May run automatically when configured; audit and undo/stop |
| Execute external or costly action | Send message, change customer appointment, place order | Explicit approval or tightly scoped organization policy |
| Legally/financially sensitive action | Finalize invoice, payment, contract, payroll/time decision, deletion | Strong authorization and normally explicit human approval |

The organization may configure narrower permissions. It should not be allowed to weaken non-negotiable security, tenant, or legal safeguards.

## Role And UX Principles

- Ordinary users should benefit from automation without understanding prompts, models, or workflow graphs.
- Field workers should see short, contextual requests and drafts—not an automation control center.
- Office users should see the exact source, proposed change, recipient, and downstream effect.
- Admins should control connections, permissions, budgets, policies, and published workflows.
- Natural-language setup should produce a transparent configuration, never a hidden instruction.
- German UI copy should distinguish `Vorschlag`, `Entwurf`, `wartet auf Freigabe`, `ausgeführt`, and `fehlgeschlagen`.
- AI should not create constant low-value notifications or reduce confidence in ordinary product behavior.
- Every automation should have an owner, description, status, last run, next run/trigger, and visible history.

## Trust, Security, And Operational Requirements

### Permission And Tenant Safety

- Never retrieve or act outside the active organization.
- Evaluate permissions at execution time, not only when a workflow is created.
- Separate the creator, approver, connection owner, and execution identity.
- Revoke or pause workflows when required access disappears.

### Privacy And Data Use

- Identify model and connector data processors before release.
- Define retention for prompts, files, outputs, traces, and provider logs.
- Avoid using organization data for model training without explicit, valid agreement.
- Minimize employee, customer, financial, and document data sent to a provider.
- Provide deletion/export behavior consistent with the source record.

### Reliability

- Use duplicate-safe actions and external idempotency where available.
- Make retry state and terminal failure visible.
- Prevent retry storms and repeated customer/supplier actions.
- Pause workflows when a dependency is unhealthy or configuration becomes invalid.
- Preserve the last safe state and provide a manual recovery path.

### Cost And Abuse Control

- Set organization and workflow usage limits.
- Estimate or cap expensive runs where practical.
- Restrict bulk communication and external actions.
- Detect loops and runaway fan-out.
- Show cost/usage at a level the buyer can understand.

### Evaluation And Quality

- Test on real, permission-safe SHK examples and edge cases.
- Evaluate factual extraction separately from writing quality.
- Track acceptance, correction, failure, and harmful-action rates.
- Re-evaluate after model, prompt, tool, or workflow changes.
- Never use fluent output as the only quality signal.

## Boundaries And Decision Gates

- A generic workflow canvas is not the first AI feature.
- Agents should not operate across every organization object by default.
- Automatic supplier orders, final invoices, payments, employment decisions, destructive actions, and legal communications require strong controls.
- AI should not diagnose equipment faults or provide legal, tax, or safety conclusions as established fact.
- Customer-facing bots and autonomous phone handling need an explicit handoff, disclosure, recording, and escalation policy.
- Cross-organization benchmarking requires valid consent, anonymization, and a separate product decision.
- Model-provider, hosting, and data-residency decisions must be made before sensitive workloads. The accepted hosting boundary ([decision 0001](../../docs/decisions/0001-infrastructure-stack.md)): Phase 2 calls external model provider APIs (Anthropic/OpenAI/OpenRouter) with server-side keys — WerkFlow does not self-host models or run GPU infrastructure. Long-running automation/agent runtimes are expected to run as Railway workers; workflow state, approvals, budgets, and audit stay in Postgres.
- AI features may be usage-metered later, but pricing is not defined in this document.

## Open Product Decisions

- Which Level 1 assistant provides the first clear customer value?
- Which business events and product actions are stable enough for the first templates?
- Which customer communication channels should be connected first?
- Which external accounting, calendar, supplier, and messaging systems are priorities?
- Which control levels may an organization configure, and which are fixed?
- How should workflow ownership transfer when an employee leaves?
- How should a workflow version change affect in-flight runs?
- What execution history and source material should different roles see?
- What budgets, quotas, and rate limits should exist?
- When does a recommendation require professional domain validation?
- Should custom workflows be limited to admins or allow delegated automation managers?
- Which conditions must be met before bounded agents can perform external actions?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
- [Decision 0001 — infrastructure stack](../decisions/0001-infrastructure-stack.md) — Phase 2 AI hosting via provider APIs.
