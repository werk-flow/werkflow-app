---
name: staging-journey
description: Use when an agent must prove a flow on staging end to end without the owner: a DEV test user and organization, sign-in past Vercel Authentication, a payment in the Stripe sandbox, rows, mails or webhooks checked afterwards, and cleanup. Covers `bun run staging:*`, the journey kit, staging's runtime logs, and how to write a new journey.
---

# Staging journeys

A staging journey drives the deployed `main` (staging) in a real browser as a new user would, with this machine's [agent keys](../../../docs/technical/machine-setup.md#agent-keys). It finds what the test groups cannot see: staging's configuration, its Stripe sandbox and webhooks, DEV's data. It never gates CI or a release ([testing](../../../docs/technical/testing.md#ci)).

Use one when a change touches a provider, the deployed configuration or a flow across Stripe and the app, after its PR merged and `staging.yml` deployed it. Use the test groups for everything else.

## Before you start

1. `bun run agent-access:check` passes on this machine. Without its keys, report that and stop: never borrow another machine's key.
2. The commit you want to prove is on staging: the newest `staging.yml` run on `main` passed.

## Commands

```bash
bun run staging:smoke                       # actor, sign-in, sandbox payment, dashboard, cleanup
bun run staging:cleanup                     # removes every run older than a day
bun run staging:cleanup -- --run <run id>   # removes one run now
```

A journey prints one `[staging]` line per step with ids and states, and ends with `result=passed` or `result=failed`. A failure prints its step's first line and leaves a screenshot path under `.agent-logs/staging/<run id>/`.

Start a journey that can outlast one tool call notified ([wait for a long run](../../../docs/technical/testing.md#wait-for-a-long-run)):

```bash
bun scripts/run-notified.ts --began "[staging] run" -- bun run staging:smoke
```

## What the kit does

`scripts/staging/kit.ts` holds the pieces. Each journey uses them; none reads a key itself.

- **Actor.** `createActor` makes a confirmed DEV user through the secret key, so no mail goes out: `agent+<run id>@werkflow-agents.test`, a generated password kept in the gitignored run folder `.agent-logs/staging/<run id>/`, mode 600. Its organization is `Agenten-Test <run id>`, created through the app's onboarding.
- **Browser.** `withStagingBrowser` runs a journey on staging's origin only. It adds the bypass header, and asks for Vercel's bypass cookie, only on requests to staging's host. It refuses every other page except a sandbox Checkout (`cs_test_`) the app sends it to, and fails the journey with the refused origin (`lib/testing/staging/boundary.ts`, Tier 1). Service workers are off, since their requests miss the bypass.
- **Payment.** `payWithTestCard` pays the open sandbox Checkout with Stripe's test card `4242 4242 4242 4242`.
- **Readers.** `readDev` reads one table's rows of one organization through the read-only DEV token, ids and states only: a column that may hold a name, an address or free text refuses the read (`lib/testing/staging/readers.ts`, Tier 1). `readStripe` reads a sandbox object with the restricted key and throws unless every object answers `livemode: false`. Staging's mail records are rows like any other (`werkflow_billing_mails`: `kind`, `state`, `attempts`, `failure_code`), since agents hold no Resend key.
- **Cleanup.** `cleanUp` selects a run only by its marks: the actor's run address, and organizations named `Agenten-Test <the same run id>` whose Admin is that actor (`lib/testing/staging/runs.ts`, Tier 1). It signs in as the actor, deletes each organization in its settings and then the account through the app, so the app ends the Stripe subscription as it would for a customer. For a run another machine started, it sets a new password through the secret key first. It then re-reads DEV and fails on any run left.
- **Printing.** `kit.log` prints ids and states and throws on a value that looks like an address or a key; a failure's message passes `redact` first.

## Read staging's runtime logs

Use the claude.ai Vercel connector, never the Vercel CLI: `get_runtime_logs` with the project `werkflow-app`, its team, `environment: "preview"`, and `since` set to the journey's start. Filter with `query` (an error code such as `werkflow_invoice_unreadable`) or `requestId`. The production hook refuses PROD's logs; never ask for `environment: "production"`. Logs are staging's own output, so they may name a DEV test address: quote codes and ids only.

## Write a new journey

1. Add `scripts/staging/<journey>.ts` and its package script `staging:<journey>`, and name the file in `knip.ts` beside the others.
2. Copy `smoke.ts`'s frame: load the kit, make a run id, run the journey in `withStagingBrowser`, and always call `cleanUp(kit, runId)` and then `cleanUp(kit, null)` in `finally`.
3. Act through the page as a user does: labels and roles, `hydrated(page)` before typing into a fresh page, a wait on the exact changed fact. Never sleep.
4. Check outcomes with the readers, scoped to the run's organization (`runOrganizationId`). Print each through `kit.log`.
5. Put pure rules in `lib/testing/staging/` with a unit test; the network parts stay in `scripts/staging/`.
6. Run it on staging and paste its `[staging]` lines into the PR.

A step that needs more of the app, such as an invoice the webhook issues, waits for the row with a bounded poll on the reader, never a fixed delay.

## Never

- Point the kit at PROD, another preview or live Stripe, or loosen `requestVerdict`, `scopedReadQuery`, `sandboxAnswer` or `selectRuns`.
- Print, log, commit, screenshot or forward a key, the actor's password or a response body. Read the key file only through `lib/security/staging-agent-keys.ts`.
- Touch any organization or user on DEV that carries no run's marks: DEV also serves the partner preview.
- Write to DEV around the app: the token is read-only on purpose, and the secret key only creates, re-keys and reads the run's actor.
- Leave a run behind. When a cleanup fails, rerun `bun run staging:cleanup -- --run <run id>` and report the run if it still fails.
- Treat a passing journey as a test group's proof, or a failing one as a flaky group: it is a finding about staging.
