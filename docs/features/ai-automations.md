# AI Automations

AI automations are future product scope for WerkFlow. They should be designed carefully after the core operational data model is stable.

## Product Goal

AI automations should help SHK businesses save time and reduce repetitive office work without making the app harder to understand or trust.

Automations should support the product purpose:

- Reduce paperwork.
- Make work more organized.
- Save time for employees or the business owner.

If an automation does not clearly help with at least one of these, it should not be added.

## Current Status

There is no confirmed AI automation module yet. Do not assume a specific agent framework, workflow engine, model provider, or automation builder.

## Example Future Automations

Possible examples include:

- Automatically ordering parts when inventory drops below a threshold.
- Automatically preparing or sending invoices after work is completed.
- Sending customers a review link after a job is finished.
- Summarizing job documentation, photos, or notes.
- Helping office staff convert messy information into structured job/project data.

These examples are product ideas, not committed implementation requirements.

## Design Principles

- Keep humans in control for business-critical actions.
- Make automation behavior visible and understandable.
- Avoid hidden changes to invoices, inventory, customer communication, or schedules.
- Prefer simple, high-value automations over a broad generic automation platform.
- Keep field-worker interaction minimal unless it directly simplifies their work.
- Ensure German user-facing copy is clear about what the automation will do.

## Risk Areas

AI automations can affect important business data and customer communication. Be careful with:

- Inventory orders.
- Invoices and offers.
- Customer messages.
- Time records.
- Deleting or modifying documents.
- Actions that could create cost or legal obligations.

Automations in these areas may need approval steps, audit logs, undo flows, or previews.

## Open Decisions

- Whether users create automations through templates, natural language, or configuration forms.
- Which automation areas should exist first.
- Which actions require human confirmation.
- Which AI/provider stack should be used.
- Whether durable workflows are needed for retries and long-running steps.
- How automation logs and audit trails should work.
- How permissions interact with creating or running automations.
