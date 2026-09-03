# P1-01 — Customer contacts and work sites

Status: closed (2026-08-04) — accepted P1-01 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Admin/Büro can maintain stable customer identity/classification, customer numbers, multiple contacts, address purposes, and durable work sites; work references the correct site/contact without duplicate customer records

## Direct dependencies

`P1-00`

## Primary and connected specs

Customers/CRM; jobs; calendar; documents

## Acceptance evidence

Implemented 2026-08-04: migration `add_client_contacts_and_sites` (tables `client_contacts`/`client_sites` with RLS + org/client validation triggers + Realtime publication, `clients.customer_number` org-unique, `jobs`/`projects` `site_id`/`contact_id`); contact/site management on the customer detail; site/contact pickers in job/project dialogs with Ort snapshot semantics; project default site with per-job override; customer-change clearing incl. project job sync; employee job-page site/contact view; `/kunden` search across contacts/sites. Fully additive — existing customers/jobs/projects unchanged, free-text `Ort` still works; address-purpose depth beyond main-address-plus-sites deferred to commercial slices. New golden spec `@P1-01` (6 checks incl. historical-location and isolation) + `GG-00` rerun: 19/19 on a fresh production build ([golden-gate-log.md](../../golden-gate-log.md)). **Accepted `complete` 2026-08-04**: CodeRabbit review of the slice commit produced 20 findings — 11 fixed (primary-flag write ordering with surfaced failure, archived-contact visibility in the site dialog, error copy/logging, tel-href normalization, validation error union, fetch-rejection recovery, harness guard/wait), 9 skipped with recorded reasons (DB triggers already enforce site-contact integrity; two pre-existing patterns noted as follow-ups: edit dialog cannot clear a project's customer, project/job sync is compensating rather than transactional; search-index scale posture documented for `P1-51`; German test titles and `Ansprechpartner` follow repo conventions). Suite rerun after fixes: 19/19 on a fresh production build

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
