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

A journey prints one `[staging]` line per step with ids and states, and ends with `result=passed` or `result=failed`. A failure prints the kit's own words, or for a browser or provider error only the action and its kind, such as `locator.click failed (TimeoutError)`: the last printed step shows where it stopped. It takes no screenshot, since a page may render a provider's error body.

Start a journey that can outlast one tool call notified ([wait for a long run](../../../docs/technical/testing.md#wait-for-a-long-run)):

```bash
bun scripts/run-notified.ts --began "[staging] run" -- bun run staging:smoke
```

## What the kit does

`scripts/staging/kit.ts` holds the pieces. Each journey uses them; none reads a key itself.

- **Actor.** `createActor` makes a confirmed DEV user through the secret key, so no mail goes out: `agent+<run id>@werkflow-agents.test`, with the run id as a marker in its app metadata, which only the secret key writes, and a generated password kept in the gitignored run folder `.agent-logs/staging/<run id>/`, mode 600. Its organization is `Agenten-Test <run id>`, created through the app's onboarding. Only an actor the kit issued opens the readers.
- **Browser.** `withStagingBrowser` runs a journey on staging, DEV's Supabase project and the sandbox Checkout's hosts only; it aborts every other request, PROD included, and fails the journey on a page outside staging except a sandbox Checkout (`cs_test_`) the app sends it to. It sends every request hop by hop and turns a page's redirect into a new navigation, so each redirect's target passes the same check before it is requested (`lib/testing/staging/route.ts`), and adds the bypass header only on requests to staging's host, never as a cookie (`lib/testing/staging/boundary.ts`, Tier 1). A journey that needs another origin adds it there, with a test. Service workers are off, since their requests miss the route. A page that redirects lands in two steps, so wait for the final URL (`expect(page).toHaveURL`) before acting on it. It refuses to start with `DEBUG` or `PWDEBUG` set: Playwright's debug log lists request headers.
- **Payment.** `payWithTestCard` pays the open sandbox Checkout with Stripe's test card `4242 4242 4242 4242`.
- **Readers.** `runOrganization` finds the organization named for the actor's run that the actor administers; `readDev` reads only that organization's rows, through the read-only DEV token, and only the columns `READABLE_COLUMNS` lists: ids, states, amounts and times (`lib/testing/staging/readers.ts`, Tier 1). A journey that needs another column adds it there, never a name, an address or free text. `readStripe` reads a sandbox object or list with the restricted key, throws unless every object answers `livemode: false`, and returns only ids, states, amounts and times. Staging's mail records are rows like any other (`werkflow_billing_mails`: `kind`, `state`, `attempts`, `failure_code`), since agents hold no Resend key.
- **Cleanup.** `cleanUp` selects a run only by its marks: an actor whose run address and run marker name the same run, and organizations named `Agenten-Test <that run id>` whose Admin is that actor (`lib/testing/staging/runs.ts`, Tier 1). It signs in as the actor, deletes each organization in its settings and then the account through the app, so the app ends the Stripe subscription as it would for a customer. It first checks the address and marker again and sets a new password through the secret key, so any machine can clean any run. It then re-reads DEV and fails on any run left.
- **Printing.** `kit.log` prints ids and states and throws on a value that holds a key or the password, or looks like an address, a key or a URL with a query. Throw `StagingFailure` with your own words for a check that fails; any other error prints as its action and kind only (`failureText`).

## Read staging's runtime logs

Use the claude.ai Vercel connector, never the Vercel CLI: `get_runtime_logs` with the project `werkflow-app`, its team, `environment: "preview"`, and `since` set to the journey's start. Filter with `query` (an error code such as `werkflow_invoice_unreadable`) or `requestId`. The production hook refuses PROD's logs; never ask for `environment: "production"`. Logs are staging's own output, so they may name a DEV test address: quote codes and ids only.

## Write a new journey

1. Add `scripts/staging/<journey>.ts` and its package script `staging:<journey>`, and name the file in `knip.ts` beside the others.
2. Copy `smoke.ts`'s frame: load the kit, make a run id, run the journey in `withStagingBrowser`, and always call `cleanUp(kit, runId)` and then `cleanUp(kit, null)` in `finally`.
3. Act through the page as a user does: labels and roles, `hydrated(page)` before typing into a fresh page, a wait on the exact changed fact. Never sleep.
4. Check outcomes with the readers on the run's organization (`runOrganization`). Print each through `kit.log`.
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
