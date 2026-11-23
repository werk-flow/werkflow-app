# AI automations

AI automations are WerkFlow's second product phase: assistance, recommendations, workflows and bounded agents that use the business's operational data to cut repetitive information work. The owner's direction is one agent on a harness WerkFlow owns, integrated into the whole app, reading data through the same authorization as a person. "WerkFlow KI" is its placeholder name; the product reads it from one constant, so the real name is one change. Build each capability only after its core workflow and data are trustworthy, and keep people in control of commitments, cost, legal records, customer communication and employee data.

## Current Product Baseline

WerkFlow KI has its storage and its switch; no chat, model provider or tool exists yet. The product has no agent framework, workflow engine, search architecture, messaging provider, integration platform or automation builder.

- **Release and switch.** WerkFlow releases WerkFlow KI per organization: the owner lists its id in `AI_ORGANIZATION_IDS` in Vercel, for Production with PROD ids and for Preview with DEV ids. The list is empty by default. In a released organization the `admin` turns it on or off in the „WerkFlow KI“ card of the organization settings; another admin's open card follows live. It starts off. An unreleased organization's admin sees „noch nicht freigeschaltet“; `buero` and `employee` see no card.
- **Chat state in Postgres.** Threads, their typed items (messages, tool calls, questions, to-do lists, files), runs and costs live in Supabase Postgres. Each item has a per-thread sequence and an idempotency key, so a retried command writes it once.
- **Private threads.** Only the author reads a thread and its items, and only while their membership has access. No admin reads another person's thread; a suspended author reads none. Clients write nothing; the server writes through database functions that recheck the author. The organization export leaves threads out.
- **Deletion.** A daily database job deletes each item 12 months after it was written, and a thread once it holds no item.
- **Cost ledger and budget.** A run reserves its most expensive outcome before it starts and settles after it ends. Every provider attempt writes an append-only ledger row with tokens, real cost in micro-USD, model and prompt version, never text; the row keeps its cost when the thread is deleted. Each organization has a monthly budget in euros, with a default set by the owner in the migration; it counts a dollar as a euro, which overstates cost, so the stop comes early. A reservation refuses when the organization is off, the budget would be exceeded, or the decision cannot be made. The run records every attempt before it settles, so the hold covers each charge. Users see no counter.

Phase 1 provides these foundations:

- One role-aware list of tasks, approvals and notifications on `/aufgaben`, derived live from the owning domains. Every AI confirmation joins it.
- An append-only event history per domain.
- Organization scoping and role authorization on every read and every action ([security.md](../technical/security.md)). Every tool the agent may call inherits this boundary.
- A closed set of authorized background reads, the pattern for read-only tool access.
- File bytes behind organization-scoped signed URLs ([document-storage-and-access.md](../technical/document-storage-and-access.md)). A model can read a document without the bytes passing through the app.
- Each handover release keeps structured snapshots beside its rendered file, so a renderer can read the customer-safe package as data.
- Transactional email for invitations and account mail, sent from an EU region. No inbound email, SMS, phone, calendar, accounting or wholesaler connector exists.
