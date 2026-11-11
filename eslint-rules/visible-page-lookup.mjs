// Lookups on the whole page in browser tests
// (docs/technical/integrated-test-state.md, "Keep the page stable during a step").
import { createPageBindings } from './playwright-page-bindings.mjs';

/**
 * Lookups that match an element whether or not it is displayed. `getByRole`
 * is not one: it reads the accessibility tree, which leaves hidden content out.
 */
const VISIBILITY_BLIND_LOOKUPS = new Set([
  'locator',
  'getByText',
  'getByLabel',
  'getByTestId',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
]);

/**
 * The helpers of tests/golden/support/steps/shared.ts that look at every DOM
 * node on purpose: an absence must hold for a hidden copy too.
 */
const WHOLE_DOM_HELPERS = new Set(['textInDom', 'expectGone']);

function insideWholeDomHelper(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'FunctionDeclaration') return WHOLE_DOM_HELPERS.has(current.id?.name);
  }
  return false;
}

/** `html` or `html[attribute]`: the one document element, which no hidden copy repeats. */
const DOCUMENT_ELEMENT_SELECTOR = /^html(?:\[[^\],\s]*\])*$/;

function isDocumentElementSelector(argument) {
  if (argument?.type === 'Literal') return DOCUMENT_ELEMENT_SELECTOR.test(String(argument.value));
  if (argument?.type !== 'TemplateLiteral') return false;
  // An interpolated attribute name or value counts as one token.
  return DOCUMENT_ELEMENT_SELECTOR.test(argument.quasis.map((quasi) => quasi.value.cooked).join('x'));
}

/** A selector whose every alternative carries Playwright's `:visible`. */
function selectsShownOnly(argument) {
  return (
    argument?.type === 'Literal' &&
    typeof argument.value === 'string' &&
    argument.value.split(',').every((alternative) => alternative.includes(':visible'))
  );
}

/** `.filter({ visible: true })` */
function isVisibleFilter(call) {
  if (call.callee.property.name !== 'filter') return false;
  const [options] = call.arguments;
  return (
    options?.type === 'ObjectExpression' &&
    options.properties.some(
      (property) =>
        property.type === 'Property' &&
        property.key.type === 'Identifier' &&
        property.key.name === 'visible' &&
        property.value.type === 'Literal' &&
        property.value.value === true,
    )
  );
}

/** Every later call of the lookup's chain (`.filter(…).first()`), and the chain's outermost call. */
function chainOf(lookup) {
  const later = [];
  let top = lookup;
  while (
    top.parent.type === 'MemberExpression' &&
    top.parent.object === top &&
    top.parent.property.type === 'Identifier' &&
    top.parent.parent.type === 'CallExpression' &&
    top.parent.parent.callee === top.parent
  ) {
    top = top.parent.parent;
    later.push(top);
  }
  return { later, top };
}

/** A `has` or `hasNot` option, or the argument of `.and(…)`: judged against an element another lookup found. */
function narrowsAnotherLookup(top) {
  const parent = top.parent;
  if (parent.type === 'Property' && parent.value === top) {
    return parent.key.type === 'Identifier' && /^has(?:Not)?$/.test(parent.key.name);
  }
  return (
    parent.type === 'CallExpression' &&
    parent.arguments.includes(top) &&
    parent.callee.type === 'MemberExpression' &&
    parent.callee.property.type === 'Identifier' &&
    parent.callee.property.name === 'and'
  );
}

/**
 * A lookup on the whole page finds only what is shown. The document can hold a
 * second, hidden copy of the content a test looks for:
 *
 * - After a load, React streams each Suspense boundary's content into a
 *   `<div hidden id="S:…">` at the end of `<body>` and reveals a batch of them
 *   up to 300 ms later. When an update reaches the boundary first, React
 *   renders its content on the client, and both copies exist until the reveal
 *   removes the streamed one.
 * - With `cacheComponents`, Next.js keeps the routes a session left mounted
 *   and hidden (`<Activity mode="hidden">`), inside the shell's `<main>`.
 *
 * A lookup by text, label, placeholder, test id, title or CSS selector matches
 * both copies, so a strict action or assertion fails on two elements, and only
 * when the timing puts the copy there. The rule accepts a lookup by role, a
 * lookup inside a located region, `.filter({ visible: true })` anywhere in the
 * chain, a `:visible` selector, a `has`/`hasNot`/`.and(…)` operand, the
 * document element, and the named whole-DOM helpers.
 */
export const visiblePageLookupRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      blind:
        'page.{{method}}(…) also matches a hidden copy of the content: the streamed boundary React reveals after a load, or a route Next.js keeps mounted. Look up by role, start from a located region, or add .filter({ visible: true }) (docs/technical/integrated-test-state.md, "Keep the page stable during a step").',
    },
  },
  create(context) {
    const pages = createPageBindings();
    return {
      ...pages.listeners,
      CallExpression(node) {
        pages.recordTestFixturePages(node);
        const method = pages.pageMethodOf(node);
        if (method === null || !VISIBILITY_BLIND_LOOKUPS.has(method)) return;
        const [selector] = node.arguments;
        if (method === 'locator' && (isDocumentElementSelector(selector) || selectsShownOnly(selector)))
          return;
        const { later, top } = chainOf(node);
        if (later.some(isVisibleFilter) || narrowsAnotherLookup(top) || insideWholeDomHelper(node)) return;
        context.report({ node, messageId: 'blind', data: { method } });
      },
    };
  },
};
