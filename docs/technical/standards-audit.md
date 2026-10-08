# Audit a wave and accept a rendered design

Status: living — last reviewed 2026-10-05

The six virtues in `AGENTS.md` define quality for every change. Each virtue's owner doc holds its checklist, its prohibitions, its verification steps and its examples. This page holds the two procedures that the virtues refer to: how to accept a rendered design, and how to audit a wave.

A gate proves only its registered assertions on the inputs it ran on. Reusing a shared component gives its behavior. It does not prove that the caller composes it well. An earlier audit is evidence for its date, not a guarantee.

## Rendered design acceptance

Tests establish specific behaviors. They do not establish that a screen is clear, well composed, or fit for daily SHK work. That judgment is Tier 3 and it is required evidence, not an optional extra after the gates pass.

For a new major screen or a substantial redesign:

1. In the slice record, name the role, the main task, representative data and the viewports. State the intended action hierarchy and what the user must see without opening another panel. Use realistic names, long labels, crowded schedules and exceptions, not only empty states.
2. Inspect relevant reference screens. Record the pattern you adopt and why it helps that task. A competitor's feature list is not a visual specification. Existing WerkFlow pages show current behavior. They are not automatically the visual target.
3. Render one representative composition before you extend it across the feature. Compare hierarchy, toolbar height, control density, typography, alignment, reading order and the space left for content. When the owner asked for a new visual direction and the references leave it open, resolve it with a concrete rendered proposal under the protocol's stop rule. A routine change inside an accepted design needs no extra approval.
4. Review the implemented result in the browser with the named roles, themes, viewports and states. Exercise the main task, the keyboard path and the relevant error recovery. A screenshot does not prove an interaction. A successful click test does not prove visual quality.
5. Have an independent reviewer compare the result with the intended composition and the product task. Record the candidate revision, route, role, data state, theme, viewport, artifact location and findings. Inspect each cited artifact. A loading screen, a failed capture, a login page or a connection error is missing evidence, never a pass. Check the affected captures again after a visual repair.
6. Put accepted shared choices into tokens, primitives and the `werkflow-design` skill. Add a geometry, interaction or screenshot check only where it protects an accepted invariant. A screenshot baseline must not freeze an appearance the owner rejected. Keep a small reviewed set of reference images in the skill's `references/` folder.

Completion needs an explicit disposition for each visual and interaction finding beside the automated results. Visual polish cannot waive security, keyboard access, data integrity or response time. A browser review that could not run leaves the design unverified.

### Keep accepted screens as visual references

`audit:visual` (`tests/audit/visual/references.spec.ts`) compares one viewport screenshot per page family with its reference image in `references.spec.ts-snapshots/`. Each family has a desktop and a phone reference in light mode, and a desktop reference in dark mode where dark mode changes more than the token values of a neighbouring family. The spec seeds a world with constant names and numbers. Before each capture it replaces the text the app derives from the clock (dates, times, weekdays, relative times) and the run-specific strings (e-mail addresses, the join code) with constant stand-ins. Beside each image, a text reference (`.txt`) holds the visible text of the viewport after the same replacement, one line per text node. The text comparison is exact, so a changed word fails even when it moves fewer pixels than the image tolerance allows. The group runs in release mode and on an explicit `--group audit:visual`. A verification run never writes a reference, so a missing reference fails.

A reference records an appearance that the owner accepted. A failed comparison is either a design change that waits for acceptance or a regression to repair. Never update a reference to make a failing run pass.

To update the references after an intended design change:

1. Get the owner's acceptance of the rendered change through steps 4 and 5 above.
2. Run `WERKFLOW_UPDATE_VISUAL_REFERENCES=1 bun run test:audit:focused --grep @AUDIT-VISUAL`. The run rewrites each image whose difference exceeds the tolerance and each text reference that differs, and writes the missing ones. An image whose change stays under the tolerance is rewritten only when you delete it before the run. `visualReferenceUpdateMode` in `lib/testing/runner/visual-reference-updates.ts` allows the rewrite in this focused lane only. The update run certifies nothing and is no attempt of the repeat rule, so you can repeat it.
3. Show the owner every changed image in the diff. Keep only the images the owner accepts, and restore the others with `git checkout`.
4. Run `bun run test:verify --group audit:visual` and confirm that it passes. It is a first attempt on the accepted references, and a failure there follows [Failures](testing.md#failures).

## Audit a wave

1. Run the release plan on the wave's final tree (`bun run test:verify --mode release`) and the cloud canary. Do not audit a wave on a partial plan.
2. For each of the six virtues, read its block in `AGENTS.md` and the checklist of its owner doc. Walk the wave's slice records against the items tagged `judgment` and against the recorded divergences. Write one finding list per virtue with file and line. A divergence that recurs is a sign that its default should change.
3. Check registration. Every flow the wave added is a measured scenario, a component contract, a control-map row, or a catalog clause with coverage. A declined registration states its reason in the slice record.
4. Push every finding up the ladder ([decision 0005](../decisions/0005-enforcement-ladder.md)). Build the mechanism or the check where one is reachable. Otherwise add a row to the backlog. Change the virtue's rule in the same change when the finding shows that the rule was missing or wrong.
5. Record the audit in the wave's ledger under `docs/plans/phase-1/audits/`. Move every lasting fact to its living home before the ledger closes.

A finding changes its owner doc and its check. It does not trigger another audit of the whole app.
