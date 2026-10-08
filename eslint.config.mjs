import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import {
  MEASUREMENT_DIGEST_SUPPORT_FILES,
  playwrightSpecRules,
} from './eslint-rules/playwright-spec-rules.mjs';
import { qualityRules } from './eslint-rules/quality-rules.mjs';
import { uiRules } from './eslint-rules/ui-rules.mjs';
import {
  COMPONENT_FILE_LINE_LIMIT,
  FUNCTION_LINE_LIMIT,
  MODULE_LINE_LIMIT,
} from './eslint-rules/size-caps.mjs';

// ENFORCEMENT LADDER TIER 2 (docs/decisions/0005-enforcement-ladder.md).
// ESLint flat config does NOT merge `no-restricted-syntax` across blocks: the
// last matching block REPLACES the rule. Every block below therefore composes
// its complete selector list from the shared sets here. When adding a rule,
// add the selector to a set (or a new set) and recheck every block that should
// carry it — never add a lone block with a partial list, it silently disables
// the others for its files.

// Auth session scope: a bare signOut() defaults to GLOBAL and revokes the
// user's sessions on every device. One bare call in a harness helper failed
// four full certifications; the /auth/callback variant was a real cross-device
// logout bug.
const authSelectors = [
  {
    selector: 'CallExpression[callee.property.name="signOut"][arguments.length=0]',
    message:
      "signOut() without an explicit scope defaults to 'global' and revokes the user's sessions on every device. Pass { scope: 'local' } (or a deliberate 'global'/'others' with a comment). See decision 0005.",
  },
];

// The strict zod uuid check (RFC 4122 version and variant nibbles) rejects the
// hand-made production organization ids, so a validator that used it returned
// invalid_input for those tenants without logging. The app-wide validator is uuidSchema in lib/validation/uuid.ts, the one file
// exempt from this rule.
const uuidSelectors = [
  {
    selector:
      'CallExpression[callee.property.name="uuid"][callee.object.type="CallExpression"][callee.object.callee.property.name="string"]',
    message:
      "z.string().uuid() is strict RFC 4122 and rejects real production ids. Import { uuidSchema } from '@/lib/validation/uuid'.",
  },
  {
    selector: 'CallExpression[callee.object.name="z"][callee.property.name="uuid"]',
    message:
      "z.uuid() is strict RFC 4122 and rejects real production ids. Import { uuidSchema } from '@/lib/validation/uuid'.",
  },
];

const alwaysOnSelectors = [...authSelectors, ...uuidSelectors];

// The production Supabase project ref must never reach app or test code: a
// leaked ref in the harness would write test data into real customer state.
// scripts/ is exempt (the deliberate one-way auth-config sync reads prod).
const prodRefSelectors = [
  {
    selector: 'Literal[value=/jbgaqpdjauzoocplgdsn/]',
    message:
      'The PRODUCTION Supabase project ref is banned outside scripts/ — dev code and the test harness must only reach the dev project (docs/technical/environments.md).',
  },
  {
    selector: 'TemplateElement[value.raw=/jbgaqpdjauzoocplgdsn/]',
    message:
      'The PRODUCTION Supabase project ref is banned outside scripts/ — dev code and the test harness must only reach the dev project (docs/technical/environments.md).',
  },
];

// Realtime ownership (client freshness contract, docs/technical/
// realtime-and-caching.md): the central provider is the only subscription,
// auth-listener, and focus/visibility catch-up owner.
const channelSelector = {
  selector: 'CallExpression[callee.property.name="channel"]',
  message:
    'Realtime channels are owned by components/realtime/realtime-provider.tsx (client freshness contract rule 1). Consume useLiveView() or useRealtimeRouterRefresh() instead of opening a channel.',
};
const authListenerSelector = {
  selector: 'CallExpression[callee.property.name="onAuthStateChange"]',
  message:
    'Auth-state listeners are owned by the Realtime provider. Ad-hoc listeners create duplicate catch-up races (client freshness contract rule 2).',
};
const visibilitySelector = {
  selector: 'CallExpression[callee.property.name="addEventListener"][arguments.0.value="visibilitychange"]',
  message:
    "Visibility catch-up is a Realtime-provider concern (client freshness contract rule 2). New surfaces inherit the provider's coalesced catch-up instead of registering their own listener.",
};
const focusSelector = {
  selector: 'CallExpression[callee.property.name="addEventListener"][arguments.0.value="focus"]',
  message:
    'Window-focus catch-up is a Realtime-provider concern (client freshness contract rule 2); for element focus use the React onFocus prop.',
};
// Pending state binds to the awaited server call, never a router transition
// (client freshness contract rule 6).
// useServerAction (hooks/use-server-action.ts) is the sanctioned submit path.
const asyncTransitionSelectors = [
  {
    selector: 'CallExpression[callee.name="startTransition"] > ArrowFunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
  {
    selector: 'CallExpression[callee.name="startTransition"] > FunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
  {
    selector: 'CallExpression[callee.property.name="startTransition"] > ArrowFunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
  {
    selector: 'CallExpression[callee.property.name="startTransition"] > FunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
];

// No polling: live data comes from Realtime through the live-view primitive.
// Config-level exception: hooks/use-business-day-refresh.ts (a local Berlin
// date comparison on an interval — wall-clock, not server polling). Pure
// render ticks (elapsed counters, calendar now-lines) carry reasoned inline
// disables instead of config entries.
const pollingSelectors = [
  {
    selector: 'CallExpression[callee.name="setInterval"]',
    message:
      'No polling — live data comes from Realtime via useLiveView (docs/technical/realtime-and-caching.md). The only named exception is the wall-clock tick in hooks/use-business-day-refresh.ts.',
  },
  {
    selector: 'CallExpression[callee.property.name="setInterval"]',
    message:
      'No polling — live data comes from Realtime via useLiveView (docs/technical/realtime-and-caching.md). The only named exception is the wall-clock tick in hooks/use-business-day-refresh.ts.',
  },
];

const realtimeSelectors = [
  channelSelector,
  authListenerSelector,
  visibilitySelector,
  focusSelector,
  ...asyncTransitionSelectors,
  ...pollingSelectors,
];

// UI/UX consolidation canon (werkflow-design skill): registry components own
// date/time/number entry, entity selection, disclosure, and feedback. The
// migration sessions cleared every call site; these are hard errors so new
// violations cannot land.
const registrySelectors = [
  {
    // Ten hand-built search fields had drifted apart (icon offsets, heights,
    // a missing name, a clear button on one list only) by the rendered review
    // of 2026-10-02; the magnifier now belongs to the one search field.
    selector:
      'ImportDeclaration[source.value="lucide-react"] > ImportSpecifier[imported.name=/^Search(Icon)?$/]',
    message:
      'A search field is SearchInput (components/ui/search-input): it owns the magnifier, the clear button and the pending spinner. See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="date"]',
    message:
      'Native date inputs are banned — use DatePicker (components/ui/date-picker). See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="datetime-local"]',
    message:
      'Native datetime inputs are banned — use DatePicker + TimeInput (components/ui). See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="month"]',
    message:
      'Native month inputs are banned — use MonthPicker (components/ui/month-picker). See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="week"]',
    message:
      'Native week inputs are banned — pick a date with DatePicker or a month with MonthPicker. See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="checkbox"]',
    message:
      'Native checkboxes are banned — use Checkbox (components/ui/checkbox) with a Label. See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="radio"]',
    message:
      'Native radios are banned — use shadcn Select for a short fixed choice or Tabs for a segmented one. See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="range"]',
    message:
      'Native range sliders are banned — use QuantityStepper or a registered stepper. See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="role"][value.value="alert"]',
    message:
      'Raw role="alert" outside components/ui: inline errors render through ErrorText, region failures through SectionError, global feedback through Banner (feedback canon, no silent failures).',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="time"]',
    message:
      'Native time inputs are banned — use TimeInput (components/ui/time-input). See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="number"]',
    message:
      'Raw number inputs are banned — use QuantityStepper, DurationHoursInput, or Input with inputMode="decimal". See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXOpeningElement[name.name="select"]',
    message:
      'Native <select> is banned — use SearchableSelect or the shadcn Select per the werkflow-design skill registry.',
  },
  {
    selector: 'JSXOpeningElement[name.name="details"]',
    message:
      'Native <details> is banned — use FormDisclosure (components/ui/form-disclosure) per the werkflow-design skill registry.',
  },
  {
    selector: 'JSXOpeningElement[name.name="summary"]',
    message:
      'Native <summary> is banned — use FormDisclosure (components/ui/form-disclosure) per the werkflow-design skill registry.',
  },
];

// JSX expression literals carry the same static meaning as quoted attributes.
// Keep one restriction definition so adding a native type covers every spelling.
registrySelectors.push(
  ...registrySelectors.flatMap((restriction) => {
    const match = restriction.selector.match(
      /^JSXAttribute\[name\.name="([^"]+)"\]\[value\.value="([^"]+)"\]$/,
    );
    if (!match) return [];
    const [, attribute, value] = match;
    return [
      {
        ...restriction,
        selector: `JSXAttribute[name.name="${attribute}"] > JSXExpressionContainer > Literal[value="${value}"]`,
      },
      {
        ...restriction,
        selector: `JSXAttribute[name.name="${attribute}"] > JSXExpressionContainer > TemplateLiteral[expressions.length=0] > TemplateElement[value.raw="${value}"]`,
      },
    ];
  }),
);

// Styling canon (werkflow-design skill): the radius scale stops at rounded-lg
// (rounded-full stays legitimate for avatars/dots), colors come from tokens in
// app/globals.css, and gradients use the Tailwind v4 syntax if ever sanctioned.
// The page column is a primitive (components/shared/page-shell.tsx): every page
// renders PageShell → PageHeader → PageBody. Hand-rolled copies drift apart and
// lose the padding or the scroll region.
const shellSelectors = [
  {
    selector: 'Literal[value=/\\bh-full (min-w-0 )?flex-col overflow-hidden\\b/]',
    message:
      'Hand-rolled page column. Render PageShell → PageHeader → PageBody from components/shared/page-shell (design canon, Density and layout).',
  },
  {
    selector: 'Literal[value=/\\bflex-1 overflow-(y-)?auto p-4 sm:p-6\\b/]',
    message:
      'Hand-rolled page scroll region. Render PageBody from components/shared/page-shell (design canon, Density and layout).',
  },
  {
    // Six screens outside the app shell had drifted apart (no vertical
    // padding, no logo, three backgrounds) by the rendered review of 2026-10-02.
    selector: 'Literal[value=/\\bmin-h-dvh\\b.*\\bjustify-center\\b|\\bjustify-center\\b.*\\bmin-h-dvh\\b/]',
    message:
      'Hand-rolled full-screen frame. Render StandaloneScreen from components/shared/standalone-screen (design canon, Density and layout).',
  },
  {
    // The time area's subpages had copied the page title's size onto their
    // h2, so subpage and section titles shared one size (rendered review of 2026-10-02).
    selector:
      'JSXOpeningElement[name.name="h2"] > JSXAttribute[name.name="className"] Literal[value=/\\btext-(xl|2xl|3xl)\\b.*\\btracking-tight\\b|\\btracking-tight\\b.*\\btext-(xl|2xl|3xl)\\b/]',
    message:
      'An h2 copies the page title style. A subpage title is SubpageHeader (components/shared/subpage-header), one step below the PageHeader title; sections inside it use h3 (design canon, Density and layout).',
  },
  {
    // Fifteen detail cards spelled their title by hand; two on the person page
    // had drifted to other styles (rendered review of 2026-10-02).
    selector: 'Literal[value=/font-semibold uppercase tracking-wide text-muted-foreground/]',
    message:
      'Hand-written detail card title. Render SectionTitle from components/shared/section-title (design canon, Density and layout).',
  },
];

// Hover fidelity (design canon, Loading states): a row hovers only through the
// `interactive` flag of TableRow / ListRow, so a skeleton row and the loaded
// row cannot disagree. The class literal itself is the defect; components/ui
// owns the one token. State
// tints layered on an interactive row (selected, dragged) live in named
// module constants, not in the row's className literal.
const hoverSelectors = [
  {
    selector: 'Literal[value=/hover:bg-accent.50/]',
    message:
      'Row hover comes only from TableRow / ListRow `interactive` (design canon, Loading states). Render the row through the primitive (ListRow asChild for links) instead of the class literal.',
  },
  {
    selector: 'TemplateElement[value.raw=/hover:bg-accent.50/]',
    message:
      'Row hover comes only from TableRow / ListRow `interactive` (design canon, Loading states). Render the row through the primitive (ListRow asChild for links) instead of the class literal.',
  },
  {
    selector:
      'JSXOpeningElement[name.name=/^(TableRow|ListRow)$/] > JSXAttribute[name.name="className"] Literal[value=/cursor-pointer|hover:/]',
    message:
      'TableRow / ListRow take `interactive` (true or "select") instead of cursor and hover classes, so skeleton rows inherit the same behavior (design canon, Loading states).',
  },
];

// Focus rings are 2px without offsets (werkflow-design: shape, depth, and
// focus). JSX product files only: the two shadcn close buttons under
// components/ui keep theirs.
const focusRingSelectors = [
  {
    selector: 'Literal[value=/ring-offset-/]',
    message:
      'Focus rings are 2px without offsets (werkflow-design skill: shape, depth, and focus). Drop the ring-offset class.',
  },
  {
    selector: 'TemplateElement[value.raw=/ring-offset-/]',
    message:
      'Focus rings are 2px without offsets (werkflow-design skill: shape, depth, and focus). Drop the ring-offset class.',
  },
];

// Status and neutral colors come from the semantic tokens in app/globals.css
// (success, warning, info, destructive, muted). JSX product files only; the
// shadcn primitives under components/ui keep their own palette.
const PALETTE_CLASS = String.raw`\b(bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder|shadow)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]`;
const paletteSelectors = [
  {
    selector: `Literal[value=/${PALETTE_CLASS}/]`,
    message:
      "Numbered palette classes are banned in product JSX: use the semantic tokens in app/globals.css (bg-success-soft, text-warning-text, text-destructive, bg-muted, ...) per the werkflow-design skill's Color section.",
  },
  {
    selector: `TemplateElement[value.raw=/${PALETTE_CLASS}/]`,
    message:
      "Numbered palette classes are banned in product JSX: use the semantic tokens in app/globals.css (bg-success-soft, text-warning-text, text-destructive, bg-muted, ...) per the werkflow-design skill's Color section.",
  },
];

// One page title, one style (design canon, Density and layout): the h1 of an
// authenticated page is rendered by PageHeader, so a page cannot grow its own
// title size. Named exceptions below: the calendar header (bound
// to container state, canon "Loading states") and the full-screen states
// outside the app shell.
const headingSelectors = [
  {
    selector: 'JSXOpeningElement[name.name="h1"]',
    message:
      'Raw <h1>: an authenticated page renders its title through PageHeader (components/shared/page-header); a subpage of an area uses <h2> (werkflow-design skill: Density and layout).',
  },
];

// Dialog widths are the `size` prop of DialogContent (components/ui/dialog),
// so dialogs cannot drift into arbitrary widths. The two full-window viewers override the width with
// `!max-w-none`, which this pattern leaves alone.
const dialogSizeSelectors = [
  {
    selector:
      'JSXOpeningElement[name.name="DialogContent"] > JSXAttribute[name.name="className"] Literal[value=/(^| )([a-z]+:)?max-w-/]',
    message:
      'Dialog width comes from the `size` prop of DialogContent (sm, md, lg, xl, 2xl, 3xl, 4xl), not from a max-w class (werkflow-design skill: Long forms in dialogs).',
  },
];

const stylingSelectors = [
  {
    selector: 'Literal[value=/h-screen/]',
    message:
      'Viewport-height layouts use h-dvh/min-h-dvh so mobile browser chrome cannot crop or extend the page (werkflow-design skill: Density and layout).',
  },
  {
    selector: 'TemplateElement[value.raw=/h-screen/]',
    message:
      'Viewport-height layouts use h-dvh/min-h-dvh so mobile browser chrome cannot crop or extend the page (werkflow-design skill: Density and layout).',
  },
  {
    selector: 'Literal[value=/rounded-(2xl|3xl)/]',
    message:
      'The radius scale stops at rounded-lg for containers (werkflow-design skill: shape and depth). rounded-2xl+ is off-canon.',
  },
  {
    selector: 'TemplateElement[value.raw=/rounded-(2xl|3xl)/]',
    message:
      'The radius scale stops at rounded-lg for containers (werkflow-design skill: shape and depth). rounded-2xl+ is off-canon.',
  },
  {
    selector: 'Literal[value=/(bg|text|border|ring|fill|stroke)-\\[#/]',
    message:
      'Arbitrary hex color classes are banned — use the tokens in app/globals.css (werkflow-design skill: color system).',
  },
  {
    selector: 'TemplateElement[value.raw=/(bg|text|border|ring|fill|stroke)-\\[#/]',
    message:
      'Arbitrary hex color classes are banned — use the tokens in app/globals.css (werkflow-design skill: color system).',
  },
  {
    selector: 'Literal[value=/bg-gradient-/]',
    message:
      'Tailwind v3 gradient syntax — this app is Tailwind v4 (bg-linear-*), and gradients are off-canon anyway (werkflow-design skill).',
  },
];

// The bottom-right corner of every authenticated page belongs to the clock
// button. A page action that floats there (the service lists' create buttons,
// found in the rendered review of 2026-10-02) sits under it on a phone, so
// page actions live in the page header or the subpage toolbar. Named floating
// layers: the clock button, the mobile navigation drawer, the calendar's
// side panels, and the two drag previews that follow the pointer.
const FIXED_POSITION = String.raw`(^|\s)([a-z0-9-]+:)*fixed(\s|$)`;
const floatingSelectors = [
  {
    selector: `Literal[value=/${FIXED_POSITION}/]`,
    message:
      'Fixed positioning is reserved for the named floating layers (clock button, navigation drawer, calendar panels, drag previews). Put a page action in PageHeader or the subpage toolbar (werkflow-design skill: Density and layout).',
  },
  {
    selector: `TemplateElement[value.raw=/${FIXED_POSITION}/]`,
    message:
      'Fixed positioning is reserved for the named floating layers (clock button, navigation drawer, calendar panels, drag previews). Put a page action in PageHeader or the subpage toolbar (werkflow-design skill: Density and layout).',
  },
];
const floatingLayerFiles = [
  'components/clock-fab.tsx',
  'components/sidebar/app-shell.tsx',
  'components/kalender/dispatch-panel.tsx',
  'components/kalender/parkplatz-panel.tsx',
  'components/kalender/drag-engine/drag-engine.tsx',
  'components/dokumente/document-library-table-drag-badge.tsx',
];

// Dates are stored as YYYY-MM-DD and read as 01.09.2026. The time area and
// the planning conflicts rendered the stored value as text (rendered review
// of 2026-10-02); a field whose name ends in Date, From or Until is a stored
// date, so the JSX text spellings of rendering one directly are rejected.
const dateTextSelectors = [
  {
    selector: 'JSXElement > JSXExpressionContainer > MemberExpression[property.name=/(Date|From|Until)$/]',
    message:
      'A stored YYYY-MM-DD date rendered as text. Format it with formatGermanDate (lib/utils) so people read 01.09.2026 (werkflow-design skill: German copy).',
  },
  {
    selector:
      'JSXElement > JSXExpressionContainer > ConditionalExpression > TemplateLiteral > MemberExpression[property.name=/(Date|From|Until)$/]',
    message:
      'A stored YYYY-MM-DD date rendered as text. Format it with formatGermanDate (lib/utils) so people read 01.09.2026 (werkflow-design skill: German copy).',
  },
  {
    selector:
      'JSXElement > JSXExpressionContainer > ConditionalExpression > BinaryExpression[operator="+"] > MemberExpression[property.name=/(Date|From|Until)$/]',
    message:
      'A stored YYYY-MM-DD date rendered as text. Format it with formatGermanDate (lib/utils) so people read 01.09.2026 (werkflow-design skill: German copy).',
  },
];

// A clock time has one home: an inline toLocaleTimeString copy drifts to the
// browser's time zone and renders differently on the server (code-quality.md).
const timeOfDaySelectors = [
  {
    selector: 'CallExpression[callee.property.name="toLocaleTimeString"]',
    message:
      'Format a clock time with formatBerlinTime (lib/utils), or toLocalTimeOfDay for a time input value; one home per formatter (code-quality.md).',
  },
];

// Color literals in component code: a raw hex or functional color value
// escapes the arbitrary-class ban above. JSX files only; test fixtures may hold hex.
const colorLiteralSelectors = [
  {
    selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
    message:
      'Hex color literals belong in app/globals.css as tokens; components reference var(--token) (werkflow-design skill: color system).',
  },
  // Functional colour literals in class strings, style values and <style>
  // strings, which the hex rule above does not see.
  {
    selector: String.raw`Literal[value=/\b(?:rgba?|hsla?|oklch|oklab)\(/]`,
    message:
      'Functional colour literals (rgb, rgba, hsl, oklch) belong in app/globals.css as tokens; use the calendar or semantic token classes (werkflow-design skill: color system).',
  },
  {
    selector: String.raw`TemplateElement[value.raw=/\b(?:rgba?|hsla?|oklch|oklab)\(|(?:^|[^\w-])#[0-9a-fA-F]{6}\b/]`,
    message:
      'Colour literals inside template strings (embedded styles, gradients) belong in app/globals.css as tokens (werkflow-design skill: color system).',
  },
];

// Spec-lint set (docs/technical/testing.md). Spec files compose named steps
// and semantically scoped locators; the banned patterns below are the
// recurring flake classes from the incident log. The full Playwright API stays
// available to the shared support modules (tests/golden/support/**), which own
// the bounded, documented exceptions.
const specSelectors = [
  {
    selector: 'CallExpression[callee.object.name="test"][callee.property.name="setTimeout"]',
    message:
      'Per-test timeout overrides hide regressions and make target budgets meaningless. Use the measured target-keyed default in the Playwright config and fix or classify tests that exceed it.',
  },
  {
    selector: 'CallExpression[callee.object.name="test"][callee.property.name="slow"]',
    message:
      'test.slow() silently triples the configured timeout and bypasses the measured scenario budget. Keep the shared target-keyed budget honest and fix or classify tests that exceed it.',
  },
  {
    selector: 'CallExpression[callee.object.name="test"][callee.property.name=/^(fixme|only|skip)$/]',
    message:
      "Committed test.only/test.skip/test.fixme silently removes evidence from certification. Keep the test runnable and use the runner's focused or diagnostic mode when narrowing locally.",
  },
  {
    selector:
      'CallExpression[callee.object.object.name="test"][callee.object.property.name="describe"][callee.property.name=/^(only|skip)$/]',
    message:
      "Committed test.describe.only/test.describe.skip silently removes evidence from certification. Keep the suite runnable and use the runner's focused or diagnostic mode when narrowing locally.",
  },
  {
    selector: 'CallExpression[callee.property.name="first"][arguments.length=0]',
    message:
      'Positional locators (.first/.last/.nth) break when the full serial run adds rows a focused run never sees (testing.md: scope locators semantically). Tighten the locator (exact name, owning row/section) or assert order explicitly with toHaveText([...]); a genuinely positional need belongs in a documented support helper.',
  },
  {
    selector: 'CallExpression[callee.property.name="last"][arguments.length=0]',
    message:
      'Positional locators (.first/.last/.nth) break when the full serial run adds rows a focused run never sees (testing.md: scope locators semantically). Tighten the locator (exact name, owning row/section) or assert order explicitly with toHaveText([...]); a genuinely positional need belongs in a documented support helper.',
  },
  {
    selector: 'CallExpression[callee.property.name="nth"]',
    message:
      'Positional locators (.first/.last/.nth) break when the full serial run adds rows a focused run never sees (testing.md: scope locators semantically). Tighten the locator (exact name, owning row/section) or assert order explicitly with toHaveText([...]); a genuinely positional need belongs in a documented support helper.',
  },
  {
    selector: 'CallExpression[callee.property.name="waitForTimeout"]',
    message:
      'Fixed sleeps hide races and stretch runs — wait on a real app signal instead (visible persisted state, a response, a dialog close). A bounded debounce-drain belongs in a documented support helper.',
  },
  {
    selector: 'Literal[value=/werkflow-golden\\.test|Golden Test SHK|Fremde Firma/]',
    message:
      'Golden cleanup markers are minted only by tests/golden/support/seed.ts (goldenTestEmail / goldenTestOrganizationName) so every cleanable identity matches the leftover sweep by construction.',
  },
  {
    selector: 'TemplateElement[value.raw=/werkflow-golden\\.test|Golden Test SHK|Fremde Firma/]',
    message:
      'Golden cleanup markers are minted only by tests/golden/support/seed.ts (goldenTestEmail / goldenTestOrganizationName) so every cleanable identity matches the leftover sweep by construction.',
  },
];

// No silent failures (feedback canon): a rejection that a callback turns into
// nothing, `undefined` or `{}` disappears, and the surface then shows an empty
// or stale state as if it were the truth. `.catch(() => null)` is the one
// sanctioned shape, as the initializer of a variable whose null the next lines
// handle. Best-effort storage cleanup goes through discardStorageObjects
// (lib/storage/r2.ts), which logs; every other deliberate swallow carries an
// inline disable with its reason.
const CATCH_CALL = 'CallExpression[callee.property.name="catch"]';
const swallowedMessage =
  'A .catch() that returns nothing, undefined or {} swallows the failure. Report it (banner, error state, typed failure result) or log it; use `const result = await call().catch(() => null)` and handle the null. Genuine best-effort cleanup: discardStorageObjects, or an inline disable that states why the failure may vanish.';
const nullCatchMessage =
  '`.catch(() => null)` is allowed only as the initializer of a variable (`const result = await call().catch(() => null)`) whose null is handled next. Anywhere else the failure vanishes.';
const swallowedRejectionSelectors = [
  {
    selector: `${CATCH_CALL} > :function[body.type="BlockStatement"][body.body.length=0]`,
    message: swallowedMessage,
  },
  {
    selector: `${CATCH_CALL} > :function > BlockStatement > ReturnStatement[argument=null]:first-child:last-child`,
    message: swallowedMessage,
  },
  { selector: `${CATCH_CALL} > :function > Identifier[name="undefined"]`, message: swallowedMessage },
  { selector: `${CATCH_CALL} > :function > UnaryExpression[operator="void"]`, message: swallowedMessage },
  {
    selector: `${CATCH_CALL} > :function > ObjectExpression[properties.length=0]`,
    message: swallowedMessage,
  },
  {
    selector: `:not(VariableDeclarator, AwaitExpression) > ${CATCH_CALL} > :function > Literal[raw="null"]`,
    message: nullCatchMessage,
  },
  {
    selector: `:not(VariableDeclarator) > AwaitExpression > ${CATCH_CALL} > :function > Literal[raw="null"]`,
    message: nullCatchMessage,
  },
];

// A double cast through `unknown` (`value as unknown as T`) asserts a shape
// the compiler has proven wrong. Parse at the boundary or narrow instead. Test doubles under lib/ keep it.
const doubleCastSelectors = [
  {
    selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
    message:
      'No double cast through unknown: parse the value at its boundary, narrow it with a guard, or fix the declared type (typescript-best-practices skill: no `as` casts).',
  },
];

const productFiles = [
  'app/**/*.{ts,tsx}',
  'components/**/*.{ts,tsx}',
  'hooks/**/*.{ts,tsx}',
  'lib/**/*.{ts,tsx}',
];

const sonnerImportPath = {
  name: 'sonner',
  message:
    'Toasts are removed by the UI/UX consolidation — use the Banner primitive (components/ui/banner) per the feedback policy matrix.',
};
const realtimeHookMessage =
  'Consume Realtime through useLiveView (hooks/use-live-view.ts) or useRealtimeRouterRefresh — they own debounce, generation guards, keep-last-known, dialog suspension, and catch-up (client freshness contract).';
// Layering: lib/ is the domain and data layer that components build on; a
// lib module importing a component inverts the dependency.
const libToComponentsPattern = {
  regex: '^(@/|(\\.\\./)+)components/',
  message:
    'lib/ must not import from components/: move the shared type or logic into lib/ and let the component import it (AGENTS.md 4. Code quality and maintainability).',
};
function importRestrictions({ realtimeHooks = true, libLayer = false } = {}) {
  return [
    'error',
    {
      paths: [
        sonnerImportPath,
        ...(realtimeHooks
          ? [
              {
                name: '@/components/realtime/realtime-provider',
                importNames: ['useRealtimeEvent', 'useRealtimeSubscribe'],
                message: realtimeHookMessage,
              },
            ]
          : []),
      ],
      // The paths entry matches only the alias specifier; a relative import
      // (./realtime-provider) must carry the same ban.
      patterns: [
        ...(realtimeHooks
          ? [
              {
                group: ['**/realtime-provider'],
                importNames: ['useRealtimeEvent', 'useRealtimeSubscribe'],
                message: realtimeHookMessage,
              },
            ]
          : []),
        ...(libLayer ? [libToComponentsPattern] : []),
      ],
    },
  ];
}
// Pending state binds to the awaited server call (useServerAction) or to a
// list's live read, never to a router transition: a router-entangled pending
// flag turns a loaded table into a skeleton after the user's own refresh
// click. The transition primitive lives in components/ui/refresh-button.tsx;
// the named exceptions below are the organization switch and the document
// library's folder navigation, both of which track a route change rather than
// a mutation.
const transitionMessage =
  'useTransition is banned in product code: pending state comes from useServerAction / useBusyIds, and a route refresh spins through RefreshButton or useRouterRefresh (components/ui/refresh-button). See the feedback canon in the werkflow-design skill.';
const transitionSelectors = [
  {
    selector: 'ImportDeclaration[source.value="react"] > ImportSpecifier[imported.name="useTransition"]',
    message: transitionMessage,
  },
  {
    selector: 'CallExpression[callee.object.name="React"][callee.property.name="useTransition"]',
    message: transitionMessage,
  },
];
const transitionExemptFiles = [
  'components/ui/refresh-button.tsx',
  'components/organization/organization-context.tsx',
  'components/dokumente/document-library-content.tsx',
];

// Injected inline scripts: the script policy still allows 'unsafe-inline'
// (docs/technical/security.md, "Known residual exposure"), so the code must
// not create a raw HTML or code sink. React escapes every rendered value; these
// are the ways around it. No product file uses one.
const htmlSinkSelectors = [
  {
    selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
    message: 'No raw HTML: render values as React children, which escapes them (security.md, Browser).',
  },
  {
    selector: 'AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]',
    message: 'No innerHTML or outerHTML assignment: it parses the value as HTML (security.md, Browser).',
  },
  {
    selector: 'CallExpression[callee.object.name="document"][callee.property.name=/^(write|writeln)$/]',
    message: 'No document.write: it parses the value as HTML (security.md, Browser).',
  },
  {
    selector: 'CallExpression[callee.property.name="insertAdjacentHTML"]',
    message: 'No insertAdjacentHTML: it parses the value as HTML (security.md, Browser).',
  },
  {
    selector:
      'CallExpression[callee.name="eval"], NewExpression[callee.name="Function"], CallExpression[callee.name="Function"]',
    message:
      "No eval or Function constructor: the script policy has no 'unsafe-eval' (security.md, Browser).",
  },
];

// Every exception subtracts only its named permission from a complete scope.
// Flat-config replacement can no longer omit an unrelated newly added selector.
function productRestrictions({ jsx = false, allow = [] } = {}) {
  const allowed = new Set(allow);
  return [
    'error',
    ...[
      ...alwaysOnSelectors,
      ...prodRefSelectors,
      ...realtimeSelectors,
      ...stylingSelectors,
      ...transitionSelectors,
      ...swallowedRejectionSelectors,
      ...doubleCastSelectors,
      ...timeOfDaySelectors,
      ...htmlSinkSelectors,
      ...(jsx
        ? [
            ...shellSelectors,
            ...registrySelectors,
            ...hoverSelectors,
            ...colorLiteralSelectors,
            ...focusRingSelectors,
            ...paletteSelectors,
            ...headingSelectors,
            ...dialogSizeSelectors,
            ...floatingSelectors,
            ...dateTextSelectors,
          ]
        : []),
    ].filter((restriction) => !allowed.has(restriction)),
  ];
}

const eslintConfig = defineConfig([
  // `bun run lint` fails on any warning (--max-warnings 0), so a preset
  // warning is a gate failure. Next's preset reports some rules as warnings, among them
  // @next/next/no-location-assign-relative-destination, which keeps internal
  // navigation on the router; a deliberate full document load goes through
  // loadDocument (lib/navigation/document-load.ts).
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Playwright writes generated report/trace bundles on every golden-gate
    // run; without these ignores, lint walks thousands of generated files.
    'tests/golden/.report/**',
    'tests/golden/.results/**',
    'tests/golden/.artifacts/**',
    'tests/audit/.report/**',
    'tests/audit/.results/**',
    'tests/canary/.report/**',
    'tests/canary/.results/**',
    '.agent-logs/**',
  ]),
  // Everything (scripts and tests included): auth scope discipline.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...alwaysOnSelectors],
      // A `\d` inside a template literal or string is just `d`, so a pattern
      // passed to `new RegExp` silently stops matching digits (the employment
      // condition form refused „35“ Wochenstunden, wave-1 A3 audit).
      'no-useless-escape': 'error',
    },
  },
  // Lint suppressions name their rule and carry a `-- reason`; a directive
  // that no longer suppresses anything is an error.
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    plugins: eslintComments.recommended.plugins,
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      ...eslintComments.recommended.rules,
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
    },
  },
  // Exported functions under lib/ declare their parameter and return types
  // (AGENTS.md, virtue 4; owner decision). React components
  // under components/ and app/ keep inferred types; the harness is excluded.
  {
    files: ['lib/**/*.{ts,tsx}'],
    ignores: ['lib/testing/**', '**/*.test.*'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  // Size limits (eslint-rules/size-caps.mjs): modules stay under 2,000 raw
  // lines, component and route files under 500, functions under 200 lines
  // without blanks and comments. No file is exempt;
  // lib/conventions/module-caps.test.ts refuses a directive that disables them.
  {
    files: productFiles,
    ignores: ['lib/supabase/database.types.ts'],
    rules: {
      'max-lines': ['error', { max: MODULE_LINE_LIMIT, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: COMPONENT_FILE_LINE_LIMIT, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: productFiles,
    ignores: ['**/*.test.*'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: FUNCTION_LINE_LIMIT, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Narrow instead of asserting: `!` hides the missing-value branch the strict
  // index and optional flags exist to surface (typescript-best-practices
  // skill). Product code, the tests under lib/ and the Playwright specs.
  {
    files: [...productFiles, 'proxy.ts', 'tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  // The one home of the permissive uuid validator may use zod's primitives.
  {
    files: ['lib/validation/uuid.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...authSelectors],
    },
  },
  // Tests: auth scope + prod-ref quarantine (scripts stay exempt from the
  // prod-ref rule for the deliberate one-way auth-config sync).
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...alwaysOnSelectors, ...prodRefSelectors],
    },
  },
  // Spec files additionally carry the spec-lint set; the shared support
  // modules keep the full Playwright API for bounded, documented exceptions.
  {
    files: ['tests/**/*.spec.ts'],
    plugins: { 'playwright-spec': playwrightSpecRules },
    rules: {
      'playwright-spec/no-unscoped-page-selectors': 'error',
      'playwright-spec/no-visible-text-zero-count': 'error',
      'playwright-spec/no-one-shot-count-comparison': 'error',
      'no-restricted-syntax': ['error', ...alwaysOnSelectors, ...prodRefSelectors, ...specSelectors],
    },
  },
  // Locator ownership (docs/technical/testing.md): a browser spec passes data,
  // and its area module under tests/golden/support/steps/ owns the copy, the
  // structure hooks and the key presses. The performance specs are exempt:
  // the tests that record a scenario are measurement-digest inputs
  // (lib/testing/measured-test-source.ts) and change only with a recalibration
  // (enforcement-ladder backlog, "Locators of the performance specs").
  {
    files: ['tests/golden/*.spec.ts', 'tests/audit/**/*.spec.ts', 'tests/canary/**/*.spec.ts'],
    ignores: ['tests/audit/performance/**'],
    rules: {
      'playwright-spec/no-copy-in-spec-locator': 'error',
      'playwright-spec/no-locator-function-in-spec': 'error',
      'playwright-spec/no-structural-locator': 'error',
      'playwright-spec/no-raw-key-press': 'error',
      'playwright-spec/no-transport-internals': 'error',
      'playwright-spec/no-scoped-has-locator': 'error',
    },
  },
  // Support modules own locators, so they may use ancestors, but never a CSS
  // class; key presses go through the interaction module. The measurement
  // digest inputs keep their bytes (see above).
  {
    files: ['tests/golden/support/**/*.ts', 'tests/audit/support/**/*.ts', 'tests/canary/support/**/*.ts'],
    ignores: [...MEASUREMENT_DIGEST_SUPPORT_FILES, 'tests/golden/support/steps/interaction.ts'],
    plugins: { 'playwright-spec': playwrightSpecRules },
    rules: {
      'playwright-spec/no-structural-locator': ['error', { classesOnly: true }],
      'playwright-spec/no-raw-key-press': 'error',
      'playwright-spec/no-transport-internals': 'error',
      'playwright-spec/no-scoped-has-locator': 'error',
      'playwright-spec/no-one-shot-count-comparison': 'error',
    },
  },
  // Product code: auth + prod-ref + Realtime ownership + styling canon. The
  // console ban below covers product logging; no-console keeps console.log
  // out of the tests and the harness, which that ban exempts.
  {
    files: productFiles,
    rules: {
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'no-restricted-syntax': productRestrictions(),
      'no-restricted-imports': importRestrictions({ realtimeHooks: false }),
    },
  },
  // Logs without personal data (AGENTS.md "3. Security"). A provider or
  // Postgres error object carries messages, details and request data that can
  // quote row values or email addresses. Product code logs only through
  // lib/logging.ts, which writes the name, code and status of a failure; a
  // component shows a failure instead of logging it.
  {
    files: [...productFiles, 'proxy.ts'],
    ignores: ['**/*.test.*', 'lib/testing/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'console',
          message: 'Log through logError from lib/logging.ts: a raw error object can carry personal data.',
        },
      ],
    },
  },
  // A catch that only logs or drops the failure hides it from the user and
  // the caller; a genuine best effort says so with `// best-effort: <reason>`.
  {
    files: [...productFiles, 'proxy.ts'],
    ignores: ['**/*.test.*', 'lib/testing/**'],
    plugins: { quality: qualityRules },
    rules: {
      'quality/no-silent-catch': 'error',
    },
  },
  // Test doubles under lib/ may build partial fixtures through a double cast.
  {
    files: ['lib/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': productRestrictions({ allow: doubleCastSelectors }),
    },
  },
  // Product JSX outside the registry itself additionally carries the registry
  // bans (the ui/ primitives legitimately implement what others must not).
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    ignores: ['components/ui/**', 'components/shared/page-shell.tsx'],
    plugins: { ui: uiRules },
    rules: {
      'ui/label-in-spaced-container': 'error',
      'ui/no-lucide-stroke-width': 'error',
      'ui/submit-disabled-only-while-pending': 'error',
      'ui/action-disabled-only-while-pending': 'error',
      'ui/icon-button-needs-name': 'error',
      'ui/no-raw-controls': 'error',
      'ui/no-block-in-paragraph': 'error',
      'ui/dialog-pending-while-waiting': 'error',
      'no-restricted-syntax': productRestrictions({ jsx: true }),
    },
  },
  // Client state in components and hooks, registry included: a pending flag
  // is reset on the failure path too, a page-wide key listener skips a key
  // that a dialog, menu or drag already consumed, and no effect only copies
  // props or state into state.
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
    plugins: { ui: uiRules },
    rules: {
      'ui/pending-reset-on-failure': 'error',
      'ui/global-key-handler-respects-consumed': 'error',
      'ui/no-derived-state-effect': 'error',
    },
  },
  // The page title's one home, the calendar header (it stays inside its data
  // boundary and renders the canonical title style itself), and the
  // full-screen states that render outside the app shell and its PageHeader.
  {
    files: [
      'components/shared/page-header.tsx',
      'components/kalender/calendar-header.tsx',
      'app/not-found.tsx',
      'app/invite-error/**/*.tsx',
      'app/onboarding/**/*.tsx',
      'app/upgrade/**/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: headingSelectors }),
    },
  },
  // The named router-transition homes keep every other product rule. The
  // refresh primitive sits under components/ui (product set only); the two
  // product files carry the full JSX set minus the transition ban.
  {
    files: ['components/ui/refresh-button.tsx'],
    rules: {
      'no-restricted-syntax': productRestrictions({ allow: transitionSelectors }),
    },
  },
  {
    files: transitionExemptFiles.filter((file) => !file.startsWith('components/ui/')),
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: transitionSelectors }),
    },
  },
  // The named floating layers keep every other product rule.
  {
    files: floatingLayerFiles,
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: floatingSelectors }),
    },
  },
  // The page-shell primitive is the one home of the column literals the
  // shellSelectors ban; it keeps every other product rule.
  {
    files: [
      'components/shared/page-shell.tsx',
      'components/shared/standalone-screen.tsx',
      'components/shared/section-title.tsx',
    ],
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: shellSelectors }),
    },
  },
  // No product surface registers its own catch-up listeners. Named
  // exception: the wall-clock day-rollover tick.
  {
    files: ['hooks/use-business-day-refresh.ts'],
    rules: {
      'no-restricted-syntax': productRestrictions({ allow: pollingSelectors }),
    },
  },
  // The provider itself owns channels, auth listeners, and catch-up.
  {
    files: ['components/realtime/realtime-provider.tsx'],
    rules: {
      'no-restricted-syntax': productRestrictions({
        jsx: true,
        allow: [channelSelector, authListenerSelector, visibilitySelector, focusSelector],
      }),
    },
  },
  // Deliberate exception: the recovery form must react to PASSWORD_RECOVERY.
  {
    files: ['app/**/reset-password-form.tsx'],
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: [authListenerSelector] }),
    },
  },
  // Surfaces consume Realtime through the live-view family, not the raw
  // event hook: useLiveView / useRealtimeRouterRefresh own the refetch
  // discipline. The named exceptions are the two family members (they build
  // on useRealtimeSubscribe) and the one payload-consuming navigation
  // watcher (leaving a deleted project's page needs the event, not a
  // refetch).
  {
    files: productFiles,
    ignores: [
      'hooks/use-live-view.ts',
      'hooks/use-realtime-router-refresh.ts',
      'components/realtime/realtime-provider.tsx',
      'components/auftraege/project-detail/project-detail-content.tsx',
    ],
    rules: {
      'no-restricted-imports': importRestrictions(),
    },
  },
  // The layering rule for lib/, composed with the full import set above
  // (flat config replaces a rule per block). The UI and convention contract
  // tests under lib/ render or inspect components on purpose.
  {
    files: ['lib/**/*.{ts,tsx}'],
    ignores: ['lib/ui/*.test.*', 'lib/conventions/*.test.*'],
    rules: {
      'no-restricted-imports': importRestrictions({ libLayer: true }),
    },
  },
]);

export default eslintConfig;
