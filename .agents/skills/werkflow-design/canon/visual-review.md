# Visual target and review

This file holds the rules for judging a rendered screen against its visual target, and [SKILL.md](../SKILL.md) routes to it.

Existing pages establish current behavior and reusable patterns; they are not automatic visual approval. When the owner asks for a redesign, compare a representative populated screen with the chosen references before extending the composition. If the shared controls cause the problem, propose a coherent primitive/token change rather than forcing the old appearance onto the new surface. Preserve permissions, data behavior and accessibility through that change.

Follow `docs/technical/standards-audit.md` under "Rendered design acceptance". The reviewed reference images and what each one shows are in [the references README](../references/README.md) in this skill. Record the actual rendered evidence, visual findings and dispositions. Checks for radius, colors, overflow or successful clicks do not establish visual quality. Failed captures remain missing evidence. Tests adapt to the intended interaction and prove its persistence separately; test convenience is not a reason to choose a worse user experience.
