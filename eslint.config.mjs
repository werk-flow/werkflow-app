import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import {
  MEASUREMENT_DIGEST_SUPPORT_FILES,
  playwrightSpecRules,
} from './eslint-rules/playwright-spec-rules.mjs';
import { LAB_DIGEST_SUPPORT_FILES } from './eslint-rules/playwright-wait-rules.mjs';
import { qualityRules } from './eslint-rules/quality-rules.mjs';
import { realtimeRules } from './eslint-rules/realtime-rules.mjs';
import { uiRules } from './eslint-rules/ui-rules.mjs';
import {
  COMPONENT_FILE_LINE_LIMIT,
  FUNCTION_LINE_LIMIT,
  MODULE_LINE_LIMIT,
  SIZE_CAP_EXCEPTIONS,
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
// invalid_input for those tenants without logging. A hand-written uuid regex
// drifts the same way (a strict one refused production timeline cursors). The
// app-wide validator is uuidSchema or isUuid in lib/validation/uuid.ts, whose
// named exception follows the product block; the Deno edge functions, which
// cannot import it, keep only the zod bans.
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
  {
    // A regex literal with an eight-character group followed by a dash, in any spelling of the hex class.
    selector: 'Literal[regex.pattern=/\\{8\\}(?:\\(\\?:)?-/]',
    message:
      "A hand-written uuid pattern drifts from the app-wide rule and can refuse real production ids. Use isUuid or uuidSchema from '@/lib/validation/uuid'.",
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
    'Auth-state listeners are owned by the Realtime provider. Ad-hoc listeners create duplicate catch-up races (client freshness contract rule 1).',
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
// (docs/technical/realtime-and-caching.md#add-a-mutation).
// useServerAction (hooks/use-server-action.ts) is the sanctioned submit path.
const asyncTransitionSelectors = [
  {
    selector: 'CallExpression[callee.name="startTransition"] > ArrowFunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (docs/technical/realtime-and-caching.md#add-a-mutation).',
  },
  {
    selector: 'CallExpression[callee.name="startTransition"] > FunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (docs/technical/realtime-and-caching.md#add-a-mutation).',
  },
  {
    selector: 'CallExpression[callee.property.name="startTransition"] > ArrowFunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (docs/technical/realtime-and-caching.md#add-a-mutation).',
  },
  {
    selector: 'CallExpression[callee.property.name="startTransition"] > FunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (docs/technical/realtime-and-caching.md#add-a-mutation).',
  },
];

// No polling: setInterval is its own rule, realtime/no-interval
// (eslint-rules/realtime-rules.mjs), with its allow list below.
const realtimeSelectors = [
  channelSelector,
  authListenerSelector,
  visibilitySelector,
  focusSelector,
  ...asyncTransitionSelectors,
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
    // The browser draws a <datalist> popup in its own style, outside the
    // tokens, the dialog layer and the Field wiring (rendered review 2026-10-15).
    selector: 'JSXOpeningElement[name.name="datalist"]',
    message:
      'Native <datalist> is banned — offer suggestions through SearchableSelect (components/ui/searchable-select), with the typed text as an option where free text is allowed, per the werkflow-design skill registry.',
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

// One main landmark per screen (axe landmark-no-duplicate-main): the app
// shell and StandaloneScreen render it, a page renders its content inside.
// A service case detail and the prestart onboarding page each nested a
// second <main> (UI audit of 2026-10-15).
const landmarkSelectors = [
  {
    selector: 'JSXOpeningElement[name.name="main"]',
    message:
      'The app shell and StandaloneScreen own the one <main> landmark of a screen; render a <div> or <section> inside (werkflow-design skill: Density and layout).',
  },
];

// An invalid submit marks its fields and focuses the first through
// focusFirstInvalidField (lib/ui/field-validation.ts), the one home of focus
// by control id. 63 validation paths focused a control by hand, one of them a
// recipient picker whose message showed in the submit error instead of its
// Field (UI audit of 2026-10-15).
const validationFocusSelectors = [
  {
    selector:
      'CallExpression[callee.property.name="focus"][callee.object.callee.property.name=/^(getElementById|querySelector)$/]',
    message:
      'Focus a field through focusFirstInvalidField (lib/ui/field-validation) with the error on its Field; the submit stays enabled (werkflow-design skill: Forms).',
  },
];

// A running action is `Button pending` (components/ui/button), which disables
// the button, sets aria-busy and puts the spinner in the leading icon's place.
// A Spinner swapped in by hand drifts from it (the field work pack's clock
// button, UI audit of 2026-10-15).
const buttonSpinnerSelectors = [
  {
    selector:
      'JSXElement[openingElement.name.name=/^(Button|PlainButton|AlertDialogAction|AlertDialogCancel)$/] JSXOpeningElement[name.name="Spinner"]',
    message:
      'A running action is `Button pending={flag}` with its plain icon: the button shows the spinner in the icon place itself (werkflow-design skill: Loading states).',
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

// A dialog's first focus goes to its first control or to the dialog itself.
// A handler that only prevents the default leaves focus on the page's trigger,
// so Tab never enters the dialog (rendered dialog audit). A dialog that must
// not focus its first control passes `initialFocus="dialog"` to DialogContent.
const dialogFocusMessage =
  'An onOpenAutoFocus handler that only calls preventDefault leaves focus outside the dialog. Keep the default (first control) or pass initialFocus="dialog" to DialogContent (werkflow-design skill: Long forms in dialogs).';
const dialogFocusSelectors = [
  {
    selector:
      'JSXAttribute[name.name="onOpenAutoFocus"] > JSXExpressionContainer > :function[body.type="CallExpression"][body.callee.property.name="preventDefault"]',
    message: dialogFocusMessage,
  },
  {
    selector:
      'JSXAttribute[name.name="onOpenAutoFocus"] > JSXExpressionContainer > :function[body.body.length=1][body.body.0.expression.callee.property.name="preventDefault"]',
    message: dialogFocusMessage,
  },
];

// A link inside running text is a TextLink (components/ui/text-link), which is
// always underlined: next to muted text the link color alone is not told
// apart in every theme (axe link-in-text-block, rendered audit). The selector
// finds a raw `Link` or `a` whose parent element also holds visible text.
const textLinkSelectors = [
  {
    selector:
      ':matches(JSXElement, JSXFragment):has(> JSXText[value=/\\S/]) > JSXElement > JSXOpeningElement[name.name=/^(Link|a)$/]',
    message:
      'A link inside running text is a TextLink (components/ui/text-link): it stays underlined, so it is told apart from the text without color (werkflow-design skill: Component registry).',
  },
];

// The token pairs of app/globals.css meet 4.5:1 (lib/ui/contrast-contracts.test.ts);
// a token text color at reduced opacity does not, and the rendered axe pass
// found it on muted labels, counts and separators. `text-sm/6` (size with
// line height) and the viewer's white-on-black stay allowed.
// esquery reads a regex up to its next slash, so `\x2f` stands for the slash.
const textOpacityPattern =
  '/(^| )([a-z0-9-]+:)*!?text-(?!(xs|sm|base|lg|[0-9]?xl|white|black)\\x2f)[a-z-]+\\x2f[0-9]+( |$)/';
const textOpacitySelectors = [
  {
    selector: `Literal[value=${textOpacityPattern}]`,
    message:
      'A token text color at reduced opacity falls below the contrast of its token pair (axe color-contrast). Use the token itself, such as text-muted-foreground (werkflow-design skill: Color).',
  },
  {
    selector: `TemplateElement[value.raw=${textOpacityPattern}]`,
    message:
      'A token text color at reduced opacity falls below the contrast of its token pair (axe color-contrast). Use the token itself, such as text-muted-foreground (werkflow-design skill: Color).',
  },
];

// Sideways scrolling belongs to the named scroll regions of the registry
// (components/ui/scroll-region): the calendar surfaces, tab strips, area navs
// and tables from the tablet breakpoint. A page that scrolls sideways anywhere
// else hides what it cuts off, and the layout audit fails on an unnamed
// scroller. `overflow-auto` sets both axes, so a vertical list says
// `overflow-y-auto`; the marker itself is set by the registry, never by a page.
const scrollMessage =
  'A sideways scroller is a ScrollRegion with a canon name (components/ui/scroll-region); a vertical list uses overflow-y-auto (werkflow-design skill: Density and layout).';
const scrollClassPattern = '/(^| )([a-z0-9-]+:)*!?overflow(-x)?-(auto|scroll)( |$)/';
const scrollSelectors = [
  { selector: `Literal[value=${scrollClassPattern}]`, message: scrollMessage },
  { selector: `TemplateElement[value.raw=${scrollClassPattern}]`, message: scrollMessage },
  { selector: 'JSXAttribute[name.name="data-scroll-region"]', message: scrollMessage },
  { selector: 'CallExpression[callee.name="scrollRegion"]', message: scrollMessage },
  {
    selector: 'Property[key.name=/^overflow(X)?$/][value.value=/^(auto|scroll)$/]',
    message: scrollMessage,
  },
];

// Class-string bans of the styling canon, each in its Literal and its
// TemplateElement spelling, for every product file (the registry included):
// - viewport heights: `h-screen` and any `vh` length (`max-h-[80vh]`,
//   `calc(100vh-3rem)`) crop a phone page behind the browser chrome; the
//   dynamic units (`dvh`) follow it. A bottom sheet at `max-h-[80vh]` and the
//   document library's `100vh` floor were found by the UI audit of 2026-10-15.
// - radius: the scale stops at rounded-lg for every corner (`rounded-t-xl`,
//   `rounded-[4px]` and the 2xl/3xl spellings were all in use).
// - hex: an arbitrary hex value under any utility (`shadow-[#…]`,
//   `from-[#…]`) or arbitrary property (`[color:#…]`).
// - type scale: an arbitrary font size (`text-[10px]`, 88 sites below 12 px)
//   leaves the scale, whose smallest step is text-xs.
// - focus: the field border stays neutral while the ring shows focus, so no
//   `focus…:border-ring` or `border-primary` on focus.
const viewportHeightMessage =
  'Viewport-height layouts use dynamic viewport units (h-dvh, min-h-dvh, max-h-[80dvh]) so mobile browser chrome cannot crop or extend the page (werkflow-design skill: Density and layout).';
const radiusMessage =
  'The radius scale stops at rounded-lg for containers and rounded-md for controls, on every corner; rounded-full stays for avatars, dots and count badges (werkflow-design skill: Shape, depth, and focus).';
const hexClassMessage =
  'Arbitrary hex color classes are banned — use the tokens in app/globals.css (werkflow-design skill: color system).';
const typeScaleMessage =
  'An arbitrary font size leaves the type scale: the smallest step is text-xs (12 px); hierarchy comes from weight and muted color (werkflow-design skill: Shape, depth, and focus).';
const focusBorderMessage =
  'Focus is one 2px ring with a neutral field border: drop the focus border color (werkflow-design skill: Shape, depth, and focus).';
const classBans = [
  [String.raw`h-screen|[0-9]vh\b`, viewportHeightMessage],
  [String.raw`(^|[\s:!])rounded(-[a-z]{1,2})?-([2-4]?xl|\[)`, radiusMessage],
  [String.raw`-\[#|\[[a-z-]+:#`, hexClassMessage],
  [String.raw`(^|[\s:!])text-\[[0-9.]+(px|rem|em)?\]`, typeScaleMessage],
  [String.raw`(focus|focus-visible|focus-within|has-focus):border-(ring|primary)`, focusBorderMessage],
];
const stylingSelectors = [
  ...classBans.flatMap(([pattern, message]) => [
    { selector: `Literal[value=/${pattern}/]`, message },
    { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
  ]),
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

// Dates and clock times have two homes: lib/date-time/berlin.ts owns the
// Europe/Berlin zone and its date arithmetic, lib/utils.ts the German labels.
// An inline toLocale*String or Intl.DateTimeFormat copy drifts to the
// browser's or the server's time zone and from the other copies
// (code-quality.md). A toLocaleString call counts when it passes a date
// option; number formatting stays free. The zone may appear as a type.
const dateTimeHomes = ['lib/utils.ts', 'lib/date-time/berlin.ts'];
const dateTimeLabelMessage =
  'Format a date or time with formatBerlin(value, style), formatBerlinTime or formatGermanDate (lib/utils), or formatLocalCalendarDay for a local calendar day; toLocalTimeOfDay for a time input value. One home per formatter (code-quality.md).';
const timeOfDaySelectors = [
  {
    selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]',
    message: dateTimeLabelMessage,
  },
  {
    selector:
      'CallExpression[callee.property.name="toLocaleString"]:has(Property[key.name=/^(era|year|month|day|weekday|hour|minute|second|dateStyle|timeStyle|timeZone|timeZoneName|hour12|hourCycle)$/])',
    message: dateTimeLabelMessage,
  },
  {
    selector:
      ':matches(NewExpression, CallExpression)[callee.object.name="Intl"][callee.property.name="DateTimeFormat"]',
    message: dateTimeLabelMessage,
  },
  {
    selector: ':not(TSLiteralType) > Literal[value="Europe/Berlin"]',
    message:
      'The zone has one home: BERLIN_TIME_ZONE and the Berlin date helpers in lib/date-time/berlin.ts (getBusinessTodayIso, formatBerlinLocalDate, resolveBerlinWallTime, addLocalDays).',
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

// Busy signals (werkflow-design skill, "Loading states"): a placeholder is
// Skeleton and a running action is Spinner or `Button pending`, which carry
// the data-slot and aria-busy the settle step waits on
// (lib/testing/spec-support/busy-signals.ts). The app shell once pulsed
// through hand-built divs that no attribute named, so the visual settle had to
// wait on an animation class. A live status that pulses uses `animate-live`.
const busySignalMessage =
  'Render Skeleton for a placeholder and Spinner or Button pending for a running action (werkflow-design skill: Loading states). A live status that pulses uses animate-live.';
const busySignalSelectors = [
  { selector: 'Literal[value=/\\banimate-(pulse|spin)\\b/]', message: busySignalMessage },
  { selector: 'TemplateElement[value.raw=/\\banimate-(pulse|spin)\\b/]', message: busySignalMessage },
  {
    selector:
      'ImportDeclaration[source.value="lucide-react"] > ImportSpecifier[imported.name=/^Loader2(Icon)?$/]',
    message: busySignalMessage,
  },
];

// Tests settle on the busy attributes, never on an animation class: a class
// wait misses a busy control and blocks forever on a decorative pulse.
const testBusySelectors = [
  {
    selector: 'Literal[value=/\\banimate-(pulse|spin)\\b/]',
    message:
      'Settle on the busy attributes (lib/testing/spec-support/busy-signals.ts), never on an animation class.',
  },
  {
    selector: 'TemplateElement[value.raw=/\\banimate-(pulse|spin)\\b/]',
    message:
      'Settle on the busy attributes (lib/testing/spec-support/busy-signals.ts), never on an animation class.',
  },
];

// A mutation step helper returns `Persisted<Row>`, which only the readers in
// tests/golden/support/db/ build (testing.md, "Spec checklist"): a cast would
// pass a screen or URL value off as a database read, and `persisted()` used
// outside db/ would brand one without reading.
const persistedCastSelectors = [
  {
    selector:
      'TSAsExpression > TSTypeReference[typeName.name=/^Persisted/], TSTypeAssertion > TSTypeReference[typeName.name=/^Persisted/]',
    message:
      'Never cast to Persisted: return the row a reader in tests/golden/support/db/ read back after the save.',
  },
];
const persistedImportSelectors = [
  {
    selector: 'ImportSpecifier[imported.name="persisted"]',
    message:
      'Only the readers in tests/golden/support/db/ brand a row as persisted; call one of them instead.',
  },
];
const testSelectors = [
  ...alwaysOnSelectors,
  ...prodRefSelectors,
  ...testBusySelectors,
  ...persistedCastSelectors,
  ...persistedImportSelectors,
];

// Spec-lint set (docs/technical/testing.md). Spec files compose named steps
// and semantically scoped locators; the banned patterns below are the
// recurring flake classes from the incident log. The full Playwright API stays
// available to the shared support modules (tests/golden/support/**), which own
// the bounded, documented exceptions.
const specSelectors = [
  {
    selector: 'CallExpression[callee.property.name=/^(setOffline|routeWebSocket)$/]',
    message:
      'A session that must keep outdated state is frozen with freezeLiveUpdates (tests/golden/support/live.ts) before it opens the page, so a live update cannot dissolve the premise within milliseconds (testing.md, "Spec checklist").',
  },
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
// Every Radix primitive is wrapped once in components/ui: the wrapper owns the
// refresh suspension of open layers, the pending guard, focus restoration and
// dialog-aware portaling. A direct import elsewhere skips all of them.
const radixPrimitivesPattern = {
  group: ['@radix-ui/*', 'radix-ui', 'radix-ui/*'],
  message:
    'Radix primitives are wrapped once in components/ui (refresh suspension, pending guard, focus restoration). Import the registry component; see the werkflow-design component registry.',
};
function importRestrictions({ realtimeHooks = true, libLayer = false, radixPrimitives = true } = {}) {
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
        ...(radixPrimitives ? [radixPrimitivesPattern] : []),
      ],
    },
  ];
}
// Pending state binds to the awaited server call (useServerAction) or to a
// list's live read, never to a router transition: a router-entangled pending
// flag turns a loaded table into a skeleton after the user's own refresh
// click. The transition primitive lives in components/ui/refresh-button.tsx.
// The one other exception is the document library's folder and search
// navigation: its pending flag tracks a router.push/replace, not a mutation,
// and gates the library's controls until the new route props commit (the
// router offers no other signal for a navigation's end). The organization
// switch needs no exception: its overlay reads isSwitchingOrg, and it starts
// the navigation with React's plain startTransition.
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
            ...busySignalSelectors,
            ...registrySelectors,
            ...hoverSelectors,
            ...colorLiteralSelectors,
            ...focusRingSelectors,
            ...paletteSelectors,
            ...headingSelectors,
            ...landmarkSelectors,
            ...validationFocusSelectors,
            ...buttonSpinnerSelectors,
            ...dialogSizeSelectors,
            ...dialogFocusSelectors,
            ...textLinkSelectors,
            ...textOpacitySelectors,
            ...scrollSelectors,
            ...floatingSelectors,
            ...dateTextSelectors,
          ]
        : []),
    ].filter((restriction) => !allowed.has(restriction)),
  ];
}

// Type assertions (`value as T`, `<T>value`) are banned; `as const` stays
// allowed. The files that still carry assertions are listed with their count
// in eslint-rules/type-assertion-ratchet.json: the rule is off for them, and
// lib/conventions/type-assertions.test.ts fails when a listed count grows, when
// it falls without the file being lowered, or when a listed file has none left.
const typeAssertionRatchet = JSON.parse(
  readFileSync(new URL('./eslint-rules/type-assertion-ratchet.json', import.meta.url), 'utf8'),
);
const ratchetedAssertionFiles = new Set(Object.keys(typeAssertionRatchet));
// A function matcher: the listed paths hold glob characters such as (app) and [jobId].
const isRatchetedAssertionFile = (filePath) =>
  ratchetedAssertionFiles.has(relative(import.meta.dirname, filePath).replaceAll('\\', '/'));

// The files that may start an interval (realtime/no-interval). Shrink-only:
// the rule reports a listed file that starts none.
const intervalAllowList = [
  {
    file: 'hooks/use-wall-clock-tick.ts',
    reason:
      'The one wall-clock primitive: render ticks and the business-day refresh read the clock through it, never the server.',
  },
];

// Effects that ui/no-derived-state-effect reports and that cannot change yet,
// by file and setters. Shrink-only: the rule reports an entry that no longer
// matches an effect.
const derivedStateEffectExceptions = [
  {
    file: 'components/kalender/use-entry-details-draft.ts',
    setters: [
      'setIsEditing',
      'setError',
      'setEditedClockIn',
      'setEditedClockOut',
      'setEditedBreaks',
      'setRemovedBreaks',
      'setEditedBlockDate',
    ],
    reason:
      'Calendar render behaviour is recorded: the open-keyed draft reset moves into render (a tracked previous `open`) only together with a recalibration run, because removing the effect changes the hook order.',
  },
];

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
  // The Deno edge functions have their own module graph and cannot import
  // lib/validation/uuid.ts; mail-delivery checks a mail provider's message id,
  // not a database id. They keep every other always-on selector.
  {
    files: ['supabase/functions/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...alwaysOnSelectors.filter(({ selector }) => !selector.startsWith('Literal[regex')),
      ],
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
  // Type-aware rules (the TypeScript project service reads tsconfig.json), for
  // product code, tests and scripts alike. The Deno edge functions under
  // supabase/functions have their own module graph outside tsconfig.json.
  // - switch-exhaustiveness-check: a switch over a union names every member;
  //   a `default` does not count, so a new member fails where it is not handled.
  // - no-floating-promises: an unawaited promise loses its rejection. Bun's
  //   `mock.module` returns a promise only for an async factory, which no test uses.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['supabase/functions/**'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          allowDefaultCaseForExhaustiveSwitch: true,
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: false,
        },
      ],
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'bun:test', name: 'module' }] },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  ...(ratchetedAssertionFiles.size
    ? [
        {
          files: [isRatchetedAssertionFile],
          rules: { '@typescript-eslint/consistent-type-assertions': 'off' },
        },
      ]
    : []),
  // Size limits (eslint-rules/size-caps.mjs): modules stay under 800 raw
  // lines, component and route files under 500, functions under 80 lines
  // without blanks and comments (quality/function-size). The modules and
  // functions that predate these caps are listed with their ceiling in
  // eslint-rules/size-cap-exceptions.json; lib/conventions/module-caps.test.ts
  // fails on a stale entry and refuses a directive that disables a size rule.
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
  // A listed module keeps its recorded ceiling (a function matcher: the paths
  // hold glob characters such as (app) and [jobId]).
  ...Object.entries(SIZE_CAP_EXCEPTIONS.modules).map(([file, ceiling]) => ({
    files: [(filePath) => relative(import.meta.dirname, filePath).replaceAll('\\', '/') === file],
    rules: {
      'max-lines': ['error', { max: ceiling, skipBlankLines: false, skipComments: false }],
    },
  })),
  {
    files: productFiles,
    ignores: ['**/*.test.*'],
    plugins: { quality: qualityRules },
    rules: {
      'quality/function-size': [
        'error',
        { max: FUNCTION_LINE_LIMIT, exceptions: SIZE_CAP_EXCEPTIONS.functions },
      ],
    },
  },
  // Narrow instead of asserting: `!` hides the missing-value branch the strict
  // index and optional flags exist to surface (typescript-best-practices
  // skill). Every TypeScript file: product code, tests, scripts and hooks.
  // The ESLint rule modules under eslint-rules/ are JavaScript, where `!` cannot be written.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  // Tests: auth scope + prod-ref quarantine (scripts stay exempt from the
  // prod-ref rule for the deliberate one-way auth-config sync).
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...testSelectors],
    },
  },
  // The db readers brand what they read; shared.ts holds the one constructor.
  {
    files: ['tests/golden/support/db/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...testSelectors.filter((restriction) => !persistedImportSelectors.includes(restriction)),
      ],
    },
  },
  {
    files: ['tests/golden/support/db/shared.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...testSelectors.filter(
          (restriction) =>
            !persistedImportSelectors.includes(restriction) && !persistedCastSelectors.includes(restriction),
        ),
      ],
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
      'no-restricted-syntax': ['error', ...testSelectors, ...specSelectors],
    },
  },
  // Locator ownership (docs/technical/testing.md): a browser spec passes data,
  // and its area module under tests/golden/support/steps/ owns the copy, the
  // structure hooks and the key presses. The performance specs follow the
  // rules too. A test that records a measured scenario is a measurement-digest
  // input (lib/testing/measured-test-source.ts) and keeps its bytes until a
  // recalibration, so each such test that breaks a rule sits inside an
  // eslint-disable block that names its scenarios and the rules it breaks
  // (enforcement-ladder backlog, "Locators of the performance specs").
  {
    files: ['tests/golden/*.spec.ts', 'tests/audit/**/*.spec.ts', 'tests/canary/**/*.spec.ts'],
    rules: {
      'playwright-spec/no-copy-in-spec-locator': 'error',
      'playwright-spec/no-locator-function-in-spec': 'error',
      'playwright-spec/no-structural-locator': 'error',
      'playwright-spec/no-raw-key-press': 'error',
      'playwright-spec/no-transport-internals': 'error',
      'playwright-spec/no-scoped-has-locator': 'error',
      'playwright-spec/no-retried-action': 'error',
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
  // Failures in support modules (docs/technical/testing.md): no `.catch` or
  // `catch` turns a failure into a constant. A timed-out wait branches through
  // settledBeforeTimeout, and a genuine best effort names its reason in a
  // `// best-effort: <reason>` comment. Unlike the block above, this one also
  // covers the interaction module. The measurement and lab digest inputs keep
  // their bytes (see above), so their catches stay as they are.
  {
    files: ['tests/golden/support/**/*.ts', 'tests/audit/support/**/*.ts', 'tests/canary/support/**/*.ts'],
    ignores: [...MEASUREMENT_DIGEST_SUPPORT_FILES, ...LAB_DIGEST_SUPPORT_FILES],
    plugins: { 'playwright-spec': playwrightSpecRules },
    rules: {
      'playwright-spec/no-swallowed-failure': 'error',
    },
  },
  // Waits (docs/technical/testing.md): every spec and support module waits at
  // most the configured expect timeout, or names its slow operation in
  // tests/golden/support/timeouts.ts. The Playwright configs set the defaults
  // themselves. The measurement-digest inputs keep their bytes (see above); a
  // measured test that keeps a longer wait disables the rule for that line
  // with the scenario it measures.
  {
    files: ['tests/**/*.ts'],
    ignores: [
      ...MEASUREMENT_DIGEST_SUPPORT_FILES,
      ...LAB_DIGEST_SUPPORT_FILES,
      'tests/**/playwright.config.ts',
    ],
    plugins: { 'playwright-spec': playwrightSpecRules },
    rules: {
      'playwright-spec/bounded-timeout': 'error',
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
  // The one home of the permissive uuid validator spells its pattern and uses zod's primitives.
  {
    files: ['lib/validation/uuid.ts'],
    rules: {
      'no-restricted-syntax': productRestrictions({ allow: uuidSelectors }),
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
  // Test doubles under lib/ may build partial fixtures through a double cast,
  // and pin the zone or rebuild a replaced formatter as a reference value.
  {
    files: ['lib/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': productRestrictions({ allow: [...doubleCastSelectors, ...timeOfDaySelectors] }),
    },
  },
  // Product JSX outside the registry itself additionally carries the registry
  // bans (the ui/ primitives legitimately implement what others must not).
  // The class-string modules beside the components (`status-classes.ts`, the
  // form hooks) carry the same set: a palette class or a hand-rolled focus in
  // a .ts module reaches the screen like one in a .tsx file.
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    ignores: ['components/ui/**', 'components/shared/page-shell.tsx'],
    plugins: { ui: uiRules },
    rules: {
      'ui/no-raw-code-fallback': 'error',
      'ui/label-in-spaced-container': 'error',
      'ui/no-lucide-stroke-width': 'error',
      'ui/submit-disabled-only-while-pending': 'error',
      'ui/action-disabled-only-while-pending': 'error',
      'ui/icon-button-needs-name': 'error',
      'ui/no-raw-controls': 'error',
      'ui/no-block-in-paragraph': 'error',
      'ui/dialog-pending-while-waiting': 'error',
      'ui/alert-dialog-footer-actions': 'error',
      'no-restricted-syntax': productRestrictions({ jsx: true }),
    },
  },
  // Accessibility of the rendered markup, registry included (the primitives
  // render it): jsx-a11y's recommended set as errors. Rules only: Next's
  // preset already registers the plugin under `jsx-a11y`, and this block
  // replaces the preset's six warnings. Every option stays strict; the two
  // options below make a rule check more, never less:
  // - alt-text: Next's `Image` is an image too (kept from Next's preset).
  // - label-has-associated-control: `Checkbox` is a control, so
  //   `<label><Checkbox />Text</label>` counts as an associated label.
  // Where axe is stricter, axe wins: a scrollable region must be focusable
  // (scrollable-region-focusable), so such a region keeps `tabIndex={0}` with
  // a reasoned disable of jsx-a11y/no-noninteractive-tabindex.
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'jsx-a11y/alt-text': ['error', { img: ['Image'] }],
      'jsx-a11y/label-has-associated-control': ['error', { controlComponents: ['Checkbox'] }],
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
      'ui/no-derived-state-effect': ['error', { exceptions: derivedStateEffectExceptions }],
    },
  },
  // The page title's one home and the calendar header (it stays inside its
  // data boundary and renders the canonical title style itself). A screen
  // outside the app shell takes its title from StandaloneTitle
  // (components/shared/standalone-screen.tsx, below): five title styles had
  // drifted apart there (UI audit of 2026-10-15).
  {
    files: ['components/shared/page-header.tsx', 'components/kalender/calendar-header.tsx'],
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
  // The named floating layers keep every other product rule. The app shell
  // also owns the main landmark of every authenticated page.
  {
    files: floatingLayerFiles,
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: floatingSelectors }),
    },
  },
  {
    files: ['components/sidebar/app-shell.tsx'],
    rules: {
      'no-restricted-syntax': productRestrictions({
        jsx: true,
        allow: [...floatingSelectors, ...landmarkSelectors],
      }),
    },
  },
  {
    files: ['components/sidebar/app-shell-skeleton.tsx'],
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: landmarkSelectors }),
    },
  },
  // The page-shell primitive is the one home of the column literals the
  // shellSelectors ban; it keeps every other product rule. StandaloneScreen
  // also owns the main landmark and the title of a screen outside the shell.
  {
    files: ['components/shared/page-shell.tsx', 'components/shared/section-title.tsx'],
    rules: {
      'no-restricted-syntax': productRestrictions({ jsx: true, allow: shellSelectors }),
    },
  },
  {
    files: ['components/shared/standalone-screen.tsx'],
    rules: {
      'no-restricted-syntax': productRestrictions({
        jsx: true,
        allow: [...shellSelectors, ...headingSelectors, ...landmarkSelectors],
      }),
    },
  },
  // The two date and time homes keep every other product rule.
  {
    files: dateTimeHomes,
    rules: {
      'no-restricted-syntax': productRestrictions({ allow: timeOfDaySelectors }),
    },
  },
  // No polling (realtime-and-caching.md, Never): product code starts no
  // interval except the one wall-clock primitive, and no inline disable can
  // switch the rule off.
  {
    files: productFiles,
    plugins: { realtime: realtimeRules },
    rules: {
      'realtime/no-interval': ['error', { allow: intervalAllowList }],
      '@eslint-community/eslint-comments/no-restricted-disable': ['error', 'realtime/no-interval'],
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
  // The registry wraps the Radix primitives; it keeps every other import ban.
  {
    files: ['components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': importRestrictions({ radixPrimitives: false }),
    },
  },
]);

export default eslintConfig;
