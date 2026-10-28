# Audit a wave and accept a rendered design

Two procedures the virtues refer to. A gate proves only its registered assertions on the inputs it ran on. Reusing a shared component does not prove the caller composes it well. An earlier audit is evidence for its date only.

## Rendered design acceptance

Tests do not establish that a screen is clear, well composed, or fit for daily SHK work. That judgment is Tier 3 and required evidence. For a new major screen or a substantial redesign:

1. In the slice record, name the role, the main task, representative data and the viewports. State the action hierarchy and what the user must see without opening another panel. Use realistic names, long labels, crowded schedules and exceptions, not only empty states.
2. Inspect reference screens and record the pattern you adopt and why. Existing WerkFlow pages are not automatically the target.
3. Render one representative composition before you extend it. Compare hierarchy, toolbar height, density, typography, alignment, reading order and space for content. A new visual direction gets a concrete rendered proposal; a routine change inside an accepted design needs no approval.
4. Review the result in the browser with the named roles, themes, viewports and states. Exercise the main task, the keyboard path and error recovery. A screenshot does not prove an interaction; a passing click test does not prove visual quality.
5. Have an independent reviewer compare the result with the intended composition and the task. Record revision, route, role, data state, theme, viewport, artifact location and findings. A loading screen, failed capture, login page or connection error is missing evidence, never a pass. Check the affected captures again after a visual repair.
6. Put accepted shared choices into tokens, primitives and the `werkflow-design` skill. Add a geometry, interaction or screenshot check only where it protects an accepted invariant. Never keep a baseline of an appearance the owner rejected.

Each visual and interaction finding needs an explicit disposition. Visual polish cannot waive security, keyboard access, data integrity or response time. A browser review that could not run leaves the design unverified.

### Captures

- Run `bun run test:audit:focused --grep "@ACCEPT <set>"` over a set in `tests/audit/support/acceptance-sets.ts`. The fixture writes an image only of a ready screen.
- A capture id ending in `-loading` or `-error` captures that state.
- Capture a changed screen before and after the change, so the reviewer judges a pair.
- Images land under `.agent-logs/playwright-runs/<run>/acceptance/<set>/`. Only a capture whose entry in `acceptance/index.json` says `passed` is evidence. Cite it as `` `capture:<run-key>/<set>/<capture>-<width>-<scheme>` ``.

### Keep accepted screens as visual references

`audit:visual` (`tests/audit/visual/references.spec.ts`) compares one screenshot per page family with its reference, desktop and phone, light and dark. `tests/audit/support/visual-families.ts` names the families. The browser runs in Playwright's pinned image, so every reference carries the suffix `-linux`. The spec replaces clock-derived and run-specific text with constant stand-ins, and a text reference (`.txt`) beside each image must match exactly, so a changed word fails even under the pixel tolerance. A verification run never writes a reference.

A failed comparison is a design change that waits for acceptance, or a regression to repair. Never update a reference to make a run pass.

To update references after an intended design change:

1. Get the owner's acceptance of the rendered change through steps 4 and 5 above.
2. Run `WERKFLOW_UPDATE_VISUAL_REFERENCES=1 bun run test:audit:focused --grep "@AUDIT-VISUAL rendered references"`. The full title matters: the bare tag also matches `@AUDIT-VISUAL-ACCEPT`, and the runner refuses two spec files. The run rewrites differing images and text references and writes missing ones. An image under the tolerance is rewritten only when you delete it first. The update run certifies nothing and may repeat.
3. Show the owner every changed image. Keep the accepted ones and restore the others with `git checkout`.
4. Run `bun run test:verify --group audit:visual`. A failure there follows [Failures](testing.md#failures).

## Audit a wave

1. Run the release plan and the cloud canary on the wave's final tree.
2. For each virtue, read its block in `AGENTS.md` and its owner doc. Walk the wave's slice records against the Tier 3 defaults and the recorded divergences. Write one finding list per virtue with file and line. A divergence that recurs means its default should change.
3. Check registration. Every flow the wave added is a journey in `lib/testing/journeys.ts` or a measured scenario, a component contract, or a catalog clause with coverage. A declined registration states its reason in the slice record.
4. Push every finding up the ladder ([decision 0005](../decisions/0005-enforcement-ladder.md)). Build the mechanism where one is reachable; otherwise add a [backlog](enforcement-ladder-backlog.md) row. Change the rule in the same change when the finding shows it was missing or wrong.
5. Record the audit in the PR that closes the wave. Move every lasting fact to its living home.

A finding changes its owner doc and its check. It does not trigger another audit of the whole app.
