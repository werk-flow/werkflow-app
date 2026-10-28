---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, uses any 'grill' trigger phrases, or when resolving a slice's open product or design decisions with the owner before implementation.
---

Adapted for WerkFlow from mattpocock/skills (MIT).

Interview the user relentlessly until you share one understanding. Map the decisions as a **design tree**: each decision branches into the decisions that hang off it.

Work in **rounds**. The **frontier** is every decision whose prerequisites are settled. Ask the whole frontier in one round, numbered, each with your recommended answer:

```
❓ **Q1** - **<title>**: <question, with the choices>

➡️ <your recommended answer>

---

❓ **Q2** - ...
```

Wait for the answers. Recompute the frontier and ask the next round. A question that depends on another open question waits for a later round.

Facts are your job: the codebase, live Supabase state, the harness. Look them up with a subagent instead of asking. Only the questions downstream of a running lookup wait for it. Decisions are the user's.

Done when the frontier is empty: every branch visited, nothing silently assumed. Act only after the user confirms the shared understanding.
