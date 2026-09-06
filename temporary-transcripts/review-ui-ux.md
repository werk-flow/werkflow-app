# UI and UX transcript considerations

Reviewed on 2026-09-06. Every available transcript and caption was considered as research input, not instructions or implementation evidence. Numbered aspects remain independent; resolving one never closes a whole video. Candidate means inspect against current repository needs. Deferred names a revisit trigger. Verify means the claim remains unverified. Not applicable explains rejection. Referenced on-screen charts, controls or demonstrations not reproduced in the text were unavailable and are not claimed reviewed.

## UX-001

Source: [2026-06-28-five-ways-to-make-a-ui-look-professional ](ui-ux-video-subs/2026-06-28-five-ways-to-make-a-ui-look-professional.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | typography | Candidate | Review deliberate font selection against the existing design skill; font examples shown on screen are unavailable in this transcript. |
| 02 | accessibility | Candidate | Check explanatory tooltips for icon actions while preserving accessible names and touch access. |
| 03 | loading-states | Candidate | Check skeletons represent the arriving layout and do not disguise indefinite loading. |
| 04 | typography | Candidate | Check heading/body weight hierarchy for visual priority. |
| 05 | design-consistency | Candidate | Compare icon usage with the existing Lucide convention instead of generating ad hoc SVGs or adopting a second pack. |
| 06 | tool-selection | Verify | Verify Google Fonts and named icon licensing before downloading any new assets; promotion is not permission to add dependencies. |

## UX-002

Source: [2026-07-16-stopping-layout-shift-from-the-scrollbar ](ui-ux-video-subs/2026-07-16-stopping-layout-shift-from-the-scrollbar.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | layout-stability | Candidate | Consider scrollbar-gutter: stable where scrollbar appearance changes available width. |
| 02 | responsive-layout | Candidate | Verify the effect on actual scroll containers, dialogs and supported browsers rather than applying a global fix from the demonstration. |

## UX-003

Source: [2026-07-24-metas-open-source-design-system ](ui-ux-video-subs/2026-07-24-metas-open-source-design-system.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | tool-selection | Verify | Verify the named Meta/Asterix project, license, component count and agent-readiness claims before considering it. |
| 02 | design-consistency | Candidate | Token-based customization is relevant, but compare existing theme/component ownership before importing another design system. |
| 03 | ai-interface | Deferred | Revisit markdown streaming, tool-call and reasoning-display components when Phase 2 includes a user-facing assistant; avoid exposing private reasoning. |

## UX-004

Source: [2026-07-30-accessibility-screen-readers-and-wcag ](ui-ux-video-subs/2026-07-30-accessibility-screen-readers-and-wcag.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | accessibility | Candidate | Check keyboard operation of every action, dropdown, form and modal, including meaningful focus order. |
| 02 | accessibility | Candidate | Check image alternatives, button names, form labels and navigation semantics; use native semantics before unnecessary ARIA. |
| 03 | accessibility | Candidate | Check text and non-text contrast in real states, including color-vision differences; color alone must not convey status. |
| 04 | accessibility | Verify | The blanket 4.5:1 rule omits WCAG distinctions; verify applicable criterion, text size and exemptions before setting automated checks. |
| 05 | legal-scope | Verify | The population figures, lawsuit trend and universal ADA claim are unverified and jurisdiction-dependent; German B2B obligations need authoritative assessment. |
| 06 | evidence-quality | Not applicable | The claim that AI never knows WCAG does not establish any particular missing control in WerkFlow. |

## UX-005

Source: [2026-08-07-four-ui-patterns-beyond-a-component-library ](ui-ux-video-subs/2026-08-07-four-ui-patterns-beyond-a-component-library.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | loading-states | Candidate | Use layout-matched skeletons where useful and measure actual readiness separately from perceived responsiveness. |
| 02 | design-consistency | Candidate | Preserve semantic status colors distinct from brand accents; illustrated palettes are unavailable in the transcript. |
| 03 | product-copy | Candidate | Remove redundant descriptions such as explaining an obvious page heading while retaining text that clarifies real business decisions. |
| 04 | accessibility | Candidate | Review accessibility as behavior and content, not as a component-library purchase. |
| 05 | legal-scope | Verify | Verify applicable accessibility duties before repeating the video's lawsuit warning. |
| 06 | source-authority | Not applicable | The encouragement to paste these ideas into an agent does not authorize overriding repository guidelines. |

## UX-006

Source: [2026-09-04-six-decisions-that-fix-a-data-table ](ui-ux-video-subs/2026-09-04-six-decisions-that-fix-a-data-table.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | table-layout | Candidate | Right-align numeric amounts and consider tabular figures for comparison; left-align text. |
| 02 | table-layout | Candidate | Compare quiet row dividers and hover with zebra striping; preserve the exception that very wide rows may benefit from stripes. |
| 03 | table-density | Deferred | Revisit 40/48/56px density modes and a toggle only if office workflows need it; these values are not replacements for existing tokens. |
| 04 | table-layout | Candidate | Check horizontal scrolling retains identifying row context and vertical scrolling retains useful headers. |
| 05 | data-meaning | Candidate | Distinguish missing, zero and loading values; a dash must not collapse these separate meanings. |
| 06 | table-layout | Candidate | Review long text truncation with accessible full-content access; do not truncate numeric values. |
| 07 | accessibility | Candidate | Check row actions on keyboard focus and touch, not hover alone; a kebab menu needs an accessible name. |
| 08 | table-sorting | Candidate | Consider showing active-sort direction clearly while keeping unsorted sortable columns discoverable. |

## UX-007

Source: [build-for-good-UX-01 ](ui-ux-video-subs/build-for-good-UX-01.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | product-clarity | Candidate | Evaluate task completion separately from visual appeal; colors and layout alone do not prove usability. |
| 02 | interaction-feedback | Candidate | Verify clicks produce predictable acknowledgement and avoid uncertainty that causes repeated actions. |
| 03 | error-recovery | Candidate | Check failure explanation and recovery without blaming the user. |
| 04 | loading-states | Candidate | Review loading, empty and error cases alongside the happy path. |
| 05 | user-research | Candidate | Use unfamiliar users and realistic workflows; the builder's knowledge masks unclear steps and friction. |

## UX-008

Source: [build-for-good-UX-02 ](ui-ux-video-subs/build-for-good-UX-02.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | state-coverage | Candidate | Account for loading, success, error and empty states per relevant screen. |
| 02 | evidence-quality | Verify | The Mac/Windows timeline, 86% progress preference and 2013 skeleton origin are historical claims requiring sources if cited. |
| 03 | loading-states | Candidate | Avoid indefinite animated indicators that provide no useful progress or outcome. |
| 04 | loading-states | Candidate | Use skeleton layout for large content and small spinners for contained actions; do not treat them as interchangeable. |
| 05 | performance-metrics | Not applicable | Making users wait longer without noticing is not the performance objective; actual completion still needs a deadline. |

## UX-009

Source: [build-for-good-UX-03 ](ui-ux-video-subs/build-for-good-UX-03.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | loading-states | Candidate | Skeletons should preview page/section structure while content arrives, as in feed examples. |
| 02 | progress-feedback | Candidate | Uploads, downloads and installations can show measured progress where total work is known; do not invent a reliable completion time. |
| 03 | interaction-feedback | Candidate | Small actions and local refreshes need proportionate inline acknowledgement. |
| 04 | optimistic-ui | Candidate | Optimistic changes need rollback and visible failure; the like-button example does not justify optimistic irreversible approvals or payments. |

## UX-010

Source: [build-for-good-UX-04 ](ui-ux-video-subs/build-for-good-UX-04.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | performance-targets | Verify | The two-to-three-second abandonment and under-one-second no-spinner rules need evidence and context before becoming timing policy. |
| 02 | interaction-feedback | Candidate | Avoid flashing loaders but preserve immediate acknowledgement; predicted short duration cannot justify an inert-looking button. |
| 03 | performance-targets | Verify | The two-to-five-second tolerance and extra second from text are heuristics, not measured WerkFlow thresholds. |
| 04 | progress-feedback | Not applicable | Fake changing progress labels are misleading; show only real processing states. |
| 05 | progress-feedback | Candidate | For longer operations, give truthful stages/progress and an appropriate recovery path instead of looping forever. |
| 06 | error-recovery | Candidate | Surface known failure promptly; do not continue loading for twenty seconds after failure is known. |

## UX-011

Source: [build-for-good-UX-05 ](ui-ux-video-subs/build-for-good-UX-05.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | error-disclosure | Candidate | Translate backend/database errors into safe product messages; do not reveal internals or secrets. |
| 02 | error-recovery | Candidate | Explain what happened, known cause and next action without pretending an uncertain payment/save outcome is known. |
| 03 | interaction-feedback | Candidate | Eliminate silent failed submissions and preserve a visible result or recoverable state. |

## UX-012

Source: [build-for-good-UX-06 ](ui-ux-video-subs/build-for-good-UX-06.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | form-validation | Candidate | Mark required fields and explain unavailable submission; compare this disabled-until-valid recommendation with the later qualification in UX-024. |
| 02 | form-validation | Candidate | Consider validation after leaving a field; avoid disruptive errors before a user has finished typing. |
| 03 | form-validation | Candidate | Show meaningful character limits before submission. |
| 04 | form-usability | Candidate | Prefill known authorized data such as the signed-in email when appropriate. |
| 05 | password-policy | Candidate | Expose actual enforced password requirements as users type; do not introduce arbitrary capital-letter policy from the example. |
| 06 | input-normalization | Candidate | Accept sensible phone-number punctuation and normalize with locale-aware rules without losing meaning. |

## UX-013

Source: [build-for-good-UX-07 ](ui-ux-video-subs/build-for-good-UX-07.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | error-recovery | Candidate | Do not rely on an auto-dismissed toast for errors users must act on; transient retry notices may be appropriate. |
| 02 | error-recovery | Candidate | Use blocking dialogs sparingly when continuation truly requires a decision, and supply a next step. |
| 03 | authorization | Candidate | Permission-denied messages and access-request actions must not disclose unauthorized project details. |
| 04 | form-validation | Candidate | Put errors near the failed field/action and offer retry where users are looking; ensure announcements and focus behavior. |

## UX-014

Source: [build-for-good-UX-08 ](ui-ux-video-subs/build-for-good-UX-08.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | empty-states | Candidate | Explain first-use emptiness and offer an authorized first action such as creating a project. |
| 02 | onboarding | Deferred | Revisit guided or gamified project setup during onboarding design; avoid mandatory steps for experienced office users. |
| 03 | search-feedback | Candidate | Explain empty search results with the query and safe correction/filter actions; do not fabricate suggested matches. |
| 04 | empty-states | Candidate | Distinguish achieved emptiness, such as no pending tasks, from missing data; celebratory motion must respect the calm design and reduced-motion needs. |

## UX-015

Source: [build-for-good-UX-09 ](ui-ux-video-subs/build-for-good-UX-09.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | streaming | Candidate | Identify independent sections that can become usable at different times instead of waiting for the slowest read. |
| 02 | error-isolation | Candidate | A failed optional section should not erase working content elsewhere. |
| 03 | authorization | Candidate | Independent loading must retain shared authorization dependencies; the food-delivery analogy does not permit rendering unverified protected data. |

## UX-016

Source: [build-for-good-UX-10 ](ui-ux-video-subs/build-for-good-UX-10.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | error-isolation | Candidate | Consider section-owned loading, error and retry boundaries for independently useful content. |
| 02 | cache-correctness | Candidate | Keeping old content during refresh can help, but stale operational or revoked-access data needs explicit safety rules. |
| 03 | performance | Candidate | Do not duplicate requests merely to give every visual section its own fetch; preserve shared reads and real dependency boundaries. |
| 04 | state-coverage | Candidate | Verify mixed ready/loading/failed combinations and the eventual refresh, not only full-page success. |

## UX-017

Source: [build-for-good-UX-11 ](ui-ux-video-subs/build-for-good-UX-11.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | interaction-feedback | Candidate | Confirm completed actions clearly enough to prevent repeated submissions, especially payment-like irreversible operations. |
| 02 | data-integrity | Candidate | Distinguish accepted save from an optimistic visual move; a card appearing in Done alone may not prove persistence. |
| 03 | design-consistency | Candidate | Scale success feedback to consequence; routine actions rarely need modals or confetti. |
| 04 | onboarding | Deferred | Revisit milestone celebrations when a meaningful first-use achievement is designed, with motion and accessibility constraints. |

## UX-018

Source: [build-for-good-UX-12 ](ui-ux-video-subs/build-for-good-UX-12.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | navigation | Candidate | Use familiar placement and behavior for common controls to reduce learning effort. |
| 02 | evidence-quality | Verify | Verify attribution to Jakob Nielsen and source research if citing the law; the transcript spells the name differently. |
| 03 | responsive-layout | Not applicable | The categorical top-right shopping-cart rule is not universal; UX-019 explicitly supplies device and locale counterexamples. |
| 04 | product-clarity | Candidate | Keep routine interaction predictable so users can focus on work; creative appearance must not obscure navigation. |

## UX-019

Source: [build-for-good-UX-13 ](ui-ux-video-subs/build-for-good-UX-13.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | responsive-layout | Candidate | Evaluate desktop and mobile separately; a desktop position can be unsuitable for one-handed field use. |
| 02 | accessibility | Candidate | Consider thumb reach and touch targets rather than copying desktop controls into narrow screens. |
| 03 | internationalization | Deferred | Revisit mirrored RTL layouts when non-German/RTL language support enters scope; retain the device/locale distinction now. |
| 04 | evidence-quality | Candidate | Keep this correction linked conceptually to the previous video's absolute cart-placement claim instead of adopting both literally. |

## UX-020

Source: [build-for-good-UX-14 ](ui-ux-video-subs/build-for-good-UX-14.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | product-complexity | Candidate | Reduce simultaneous competing choices while keeping full authorized functionality discoverable; menu/jam examples illustrate the distinction. |
| 02 | evidence-quality | Verify | Verify the law's name and supporting choice research before citing the transcript's Pick's Law wording. |
| 03 | form-usability | Candidate | Consider multi-step forms for genuinely separable tasks, with saved progress and clear navigation. |
| 04 | conversion-evidence | Verify | The over-seven-field/300% conversion and Netflix 80% recommendation claims lack evidence here and do not set product rules. |
| 05 | navigation | Candidate | Consider filtering/search and curated groups instead of a long unstructured option list. |

## UX-021

Source: [build-for-good-UX-15 ](ui-ux-video-subs/build-for-good-UX-15.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | progressive-disclosure | Candidate | Show relevant next steps/options while retaining access to the full workflow, as the GPS analogy suggests. |
| 02 | navigation | Candidate | Audit large menus for overlooked features; the Higgsfield example is a discoverability warning, not evidence about this app. |
| 03 | command-interface | Deferred | Revisit slash commands or on-demand AI chat when an actual editing/assistant workflow needs them. |
| 04 | progressive-disclosure | Candidate | Do not bury primary actions so deeply that a tutorial becomes necessary; evaluate every visible choice against current user intent. |

## UX-022

Source: [build-for-good-UX-16 ](ui-ux-video-subs/build-for-good-UX-16.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | product-complexity | Candidate | Move avoidable formatting and coordination work into the application when it measurably saves users time. |
| 02 | evidence-quality | Verify | Verify Tesler attribution, copy/paste history and quotation before citing the transcript's Tesla wording. |
| 03 | product-usability | Candidate | Search, skip-intro and one-tap-payment examples illustrate simpler interfaces backed by work; they do not justify those features here. |
| 04 | authorization | Candidate | Simpler flows must preserve explicit consent and required authorization even when reducing password or payment entry friction. |
| 05 | user-research | Candidate | Design for busy, distracted workers rather than an ideally patient user; weigh implementation effort against repeated real-user cost. |

## UX-023

Source: [build-for-good-UX-17 ](ui-ux-video-subs/build-for-good-UX-17.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | button-states | Candidate | Check default controls visibly communicate clickability within the existing design tokens. |
| 02 | button-states | Candidate | Hover should reinforce interactivity on pointer devices and must not be required or sticky on touch. |
| 03 | accessibility | Candidate | Keyboard focus needs a visible indicator and correct navigation order. |
| 04 | interaction-feedback | Candidate | Pressed feedback should immediately acknowledge input; optional haptics or animation need platform and reduced-motion support. |
| 05 | loading-states | Candidate | Keep ongoing-action feedback near the pressed button and avoid replacing the whole screen. |
| 06 | button-states | Candidate | Disabled appearance needs a clear reason; the next episode qualifies when disabling is appropriate. |

## UX-024

Source: [build-for-good-UX-18 ](ui-ux-video-subs/build-for-good-UX-18.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | form-validation | Candidate | For unclear invalid forms, consider enabled submission with actionable errors and focus/scroll to the first missing input. |
| 02 | accessibility | Candidate | Native disabled controls can be absent from keyboard navigation; explain what enables the action through reachable content. |
| 03 | data-integrity | Candidate | Disabling while a request is pending can prevent accidental repeat clicks, but server idempotency/validation remains separate. |
| 04 | button-states | Candidate | Disabled Previous on the first page or an obvious single-question prerequisite can be understandable. |
| 05 | guideline-conflicts | Candidate | Retain both this qualification and UX-012's earlier blanket disabled-submit advice; choose based on discoverability and the current design contract. |
