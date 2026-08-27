# 0005 — The Enforcement Ladder

Status: closed (2026-08-27) — accepted; the open conversion backlog lives in [enforcement-ladder-backlog.md](../technical/enforcement-ladder-backlog.md)

## Decision

Every learned lesson — a diagnosed incident, an accepted review finding worth keeping, a rule agents keep violating — is pushed up a three-rung ladder before it may rest as prose:

1. **Tier 1 — make it unwritable.** Change the architecture so the mistake cannot be expressed: wrap the dangerous primitive and remove the raw form from reach, encode the invariant in a type, scope the tool so the wrong command does nothing.
2. **Tier 2 — make a check catch it.** A lint rule, unit test, runner or preflight check, or `docs:check` extension that fails on violation. The error message names the incident or doc that motivated the rule, so the why travels with the no.
3. **Tier 3 — prose.** Docs, skills, comments. Legitimate for judgment calls no mechanism can encode, and as the temporary first home of a lesson still awaiting its climb.

## Rules

- Prose is where a lesson starts, not where it is allowed to end. Every recorded prevention (incident log, review disposition, slice record) names the tier it landed on; a prose-only prevention states why Tier 1 and Tier 2 are unreachable.
- A doc or skill rule that gains enforcement keeps its prose home and states the mechanism ("enforced by …"), so readers know violation is caught and can find the check.
- A comment is advice attached to one place: it protects only the lines it sits on. A hazard worth a comment is a hazard worth a rung.
- ESLint flat config replaces `no-restricted-syntax` per file instead of merging it; the rule sets in `eslint.config.mjs` are therefore composed from shared selector arrays, and a new restriction is added to a set, never as a lone partial block.

## Why

On 2026-08-27, four full certifications failed at the final boundary because a harness helper called `signOut()` with the default global scope — while a comment beside two older helpers documented that exact hazard ("deliberately no signOut: the default scope would revoke the user's other sessions"). The knowledge existed, in prose, 2,000 lines from the decision point, and did not travel. The same shape produced the UI regressions that forced the 2026-08 UI/UX consolidation: the canon existed as a skill while the raw primitives stayed reachable. What actually held was the consolidation's final move — hard lint errors for native inputs and toasts: the 2026-08-27 audit found those rules at zero violations months of work later.

## Initial adoption (2026-08-27)

- Tier 1: `withRoleClient` wraps harness RLS sign-ins with scope-local cleanup; every app `signOut` carries an explicit scope; `lib/supabase/admin.ts` is `server-only`; `bunfig.toml` scopes `bun test` to `lib/` so browser specs only run through the repository runner; `app/globals.css` honors `prefers-reduced-motion` globally.
- Tier 2: composed rule sets in `eslint.config.mjs` — auth scope, production project-ref quarantine, Realtime ownership (channels, auth listeners, focus/visibility catch-up, with a frozen legacy allowlist that may shrink, never grow), the UI registry bans (now including `details`/`summary`), the styling canon (radius scale, arbitrary hex classes, gradient syntax), and `no-console` — plus the `typecheck` package script.
- Tier 3: this record, the ladder rule in `AGENTS.md`, and the tier column in the incident log.

The three-part audit (code comments, docs, skills) that seeded this adoption produced a substantially larger conversion backlog; it lives in [enforcement-ladder-backlog.md](../technical/enforcement-ladder-backlog.md) and feeds the Realtime/testing consolidation phase planned after P1-17.
