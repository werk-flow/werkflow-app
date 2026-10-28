# AI automations

AI automations are WerkFlow's second product phase: assistance, recommendations, workflows and bounded agents that use the business's operational data to cut repetitive information work. The owner's direction is one agent on a harness WerkFlow owns, integrated into the whole app, reading data through the same authorization as a person. "WerkFlow AI" is its placeholder name. Build each capability only after its core workflow and data are trustworthy, and keep people in control of commitments, cost, legal records, customer communication and employee data.

## Current Product Baseline

No AI automation module exists. The product has no model provider, agent framework, workflow engine, search architecture, messaging provider, integration platform, automation builder or usage model.

Phase 1 provides these foundations:

- One role-aware list of tasks, approvals and notifications on `/aufgaben`, derived live from the owning domains. Every AI confirmation joins it.
- An append-only event history per domain.
- Organization scoping and role authorization on every read and every action ([security.md](../technical/security.md)). Every tool the agent may call inherits this boundary.
- A closed set of authorized background reads, the pattern for read-only tool access.
- File bytes behind organization-scoped signed URLs ([document-storage-and-access.md](../technical/document-storage-and-access.md)). A model can read a document without the bytes passing through the app.
- Each handover release keeps structured snapshots beside its rendered file, so a renderer can read the customer-safe package as data.
- Transactional email for invitations and account mail, sent from an EU region. No inbound email, SMS, phone, calendar, accounting or wholesaler connector exists.
