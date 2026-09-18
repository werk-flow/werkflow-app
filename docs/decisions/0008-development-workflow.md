# 0008 — Development Workflow

- **Status:** accepted (2026-09-18) — adopted in pre-Wave-3 step 5 with the beta rollout of 2026-09-18 (first release under this flow: preview on DEV from `partner-preview`, production from `origin/main` at `0abbaf8`); the Vercel preview change was the one configuration step
- **Date:** 2026-09-18
- **Owner:** Product owner (Tamay), decided with the agent after the workflow research of 2026-09-17 ([pre-Wave-3 step 4](../plans/phase-1/pre-wave-3/04-wave-3-4-and-phase-2-planning.md))
- **Affects:** every publish and release; [environments.md](../technical/environments.md) carries the live configuration, `AGENTS.md` the always-on rules

## Decision

One developer with coding agents works on local `main`, verifies locally, previews for the business partner on synthetic data, and releases to production by pushing `main`. No feature branches, no pull requests, no worktrees, no branch protection, no GitHub Actions, no GitHub paid plan, no Supabase Branching, no third environment.

| Environment | Where | Database | Who sees it | How it gets there |
| --- | --- | --- | --- | --- |
| Local | the developer's machine | the local Supabase test stack (tests) and the DEV cloud project (`bun run env:dev`, canary) | the developer and the agents | every edit |
| Preview | Vercel preview deployments, the `partner-preview` branch | the DEV cloud project (`mbkkzuqjbdvzelqvuzcn`) with synthetic data | the owner and the business partner, behind Vercel's login | `git push origin main:partner-preview` |
| Production | Vercel production deployment, `origin/main` | the PROD cloud project (`jbgaqpdjauzoocplgdsn`) | every customer | `git push origin main`, on the owner's release decision |

The preview on DEV data is the staging environment. There is no other.

## The flow

1. Write code on local `main`. Migrations reach DEV as they are written (the dev-first rule of [decision 0003](0003-dev-prod-environment-split.md)); the local stack is where the tests run.
2. When a unit of work is done, run the gates locally: `bun run test:plan` and `bun run test:verify` for the selected change, the full release mode at a wave end and before a release, the cloud canary against DEV. Commit on local `main` when they pass. The protocol's slice acceptance owns the evidence.
3. Push `main` to `partner-preview`. Vercel builds a preview against DEV. Nobody outside sees it. The partner reviews it behind the Vercel login.
4. Release, on the owner's decision: apply the pending migrations to PROD inside a short maintenance window in the compatibility order the [migration rule](../technical/environments.md#the-migration-rule) sets, deploy the edge functions, then push `origin/main`. Vercel builds production against PROD. `origin/main` is the same commit the preview showed, so nothing is merged or caught up.
5. Hotfix: steps 1, 2 and 4 without step 3. Vercel's instant rollback is the undo when a production deployment misbehaves; undo the rollback afterwards so automatic assignment resumes.

Migrations reach PROD only in step 4, never earlier. Being "behind" on PROD between releases is the intended state, not drift.

## Pilot customers

During the beta there is one customer, so production is the pilot and nothing is built for it. From the second paying customer on, a feature that should be piloted ships to production hidden behind a per-organization switch that only WerkFlow staff set; the pilot organization gets it first, the switch is turned on for everyone when the pilot is over, and the switch is removed from the code afterwards. Only features the owner wants piloted get a switch. This is an organization-scoped boolean in Postgres checked server-side, not a vendor product.

## What was considered and rejected

- Feature branches with pull requests, squash merges and a ruleset on `main`: a second review surface with a GitHub Team seat (rulesets on a private organization repository need a paid plan); too much ceremony for one developer whose review is CodeRabbit on the CLI before the push.
- GitHub Actions running the static and unit gates on every push, with Vercel Deployment Checks holding a production deployment until they pass: the checks already run locally by rule; the robot would only guard against forgetting. Blacksmith and Depot only accelerate that robot and Docker image builds, of which WerkFlow has neither.
- Supabase Branching: per-hour cost, schema drift between branches and a Vercel integration for one developer; DEV is the shared non-production database and is seeded synthetically, never from PROD (the DSGVO forbids copying customer data into a test system).
- A separate staging environment or Vercel custom environment: the partner preview on DEV data is that environment.
- Vercel Pro now: the Hobby plan carries the beta; Pro is required when the first customer pays, because Hobby is for non-commercial use, and it adds the partner's own seat and an optional preview password then.
- Point-in-time recovery: at the first paying customer, with Pro.

## Configuration this decision needs

- Vercel: the Supabase URL, publishable key and every other Supabase and R2 variable scoped per environment, Preview to DEV and Production to PROD (the owner does this in the Vercel dashboard before the step 5 preview). Today every environment points at PROD.
- Nothing on GitHub, nothing on Supabase.

## Revisit triggers

- A second developer joins: reconsider branches and pull requests.
- A production incident caused by a push that skipped the gates: reconsider GitHub Actions as the enforcing robot.
- The first paying customer: Vercel Pro, PITR, and the preview password.
- The second paying customer: the per-organization pilot switch.

## Related Docs

- [environments.md](../technical/environments.md) — the live configuration, project IDs, the migration rule and the publishing commands.
- [Decision 0003](0003-dev-prod-environment-split.md) — the two-project model this flow runs on.
- [Decision 0001](0001-infrastructure-stack.md) — the stack.
- [Pre-Wave-3 step 5](../plans/phase-1/pre-wave-3/05-beta-acceptance-and-production-rollout.md) — the release that adopts this flow.
