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

/**
 * A selector whose every alternative ends in Playwright's `:visible`, so the
 * selected element itself is shown. `body:visible #id` and `#id:not(:visible)`
 * are not such selectors.
 */
function selectsShownOnly(argument) {
  return (
    argument?.type === 'Literal' &&
    typeof argument.value === 'string' &&
    argument.value.split(',').every((alternative) => alternative.trim().endsWith(':visible'))
  );
}

/** An options object that sets the named option to `true`. */
function setsTrue(options, name) {
  return (
    options?.type === 'ObjectExpression' &&
    options.properties.some(
      (property) =>
        property.type === 'Property' &&
        property.key.type === 'Identifier' &&
        property.key.name === name &&
        property.value.type === 'Literal' &&
        property.value.value === true,
    )
  );
}

/** `.filter({ visible: true })` */
function isVisibleFilter(call) {
  return call.callee.property.name === 'filter' && setsTrue(call.arguments[0], 'visible');
}

function isLookup(call) {
  return /^(?:locator|getBy[A-Z]\w*)$/.test(call.callee.property.name);
}

/** A lookup that can land on hidden content: a blind one, or a role lookup that asks for hidden elements. */
function matchesHidden(call) {
  const method = call.callee.property.name;
  if (method === 'getByRole') return setsTrue(call.arguments[1], 'includeHidden');
  if (!VISIBILITY_BLIND_LOOKUPS.has(method)) return false;
  return !(method === 'locator' && selectsShownOnly(call.arguments[0]));
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
 * when the timing puts the copy there. A role lookup with `includeHidden`
 * matches both too. The rule accepts a lookup by role, a lookup inside a
 * region located by role, `.filter({ visible: true })` after the chain's last
 * such lookup, a selector that ends in `:visible`, a `has`/`hasNot`/`.and(…)`
 * operand, an operation on the document element, and the named whole-DOM
 * helpers.
 */
export const visiblePageLookupRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      blind:
        'page.{{method}}(…) also matches a hidden copy of the content: the streamed boundary React reveals after a load, or a route Next.js keeps mounted. Look up by role, start from a region located by role, or end the lookup with .filter({ visible: true }) (docs/technical/integrated-test-state.md, "Keep the page stable during a step").',
    },
  },
  create(context) {
    const pages = createPageBindings();
    return {
      ...pages.listeners,
      CallExpression(node) {
        pages.recordTestFixturePages(node);
        const method = pages.pageMethodOf(node);
        if (method === null) return;
        const { later, top } = chainOf(node);
        // The document element stands for the page: the first lookup below it is one on the whole page.
        const isDocumentElement = method === 'locator' && isDocumentElementSelector(node.arguments[0]);
        const chain = isDocumentElement ? later.slice(later.findIndex(isLookup)) : [node, ...later];
        const [first] = chain;
        // Below the document element without a lookup, `slice(-1)` leaves a call that is no lookup.
        if (!first || !matchesHidden(first)) return;
        // Only a filter after the last such lookup holds for the element the chain ends on.
        if (chain.slice(chain.findLastIndex(matchesHidden) + 1).some(isVisibleFilter)) return;
        if (narrowsAnotherLookup(top) || insideWholeDomHelper(node)) return;
        context.report({ node, messageId: 'blind', data: { method: first.callee.property.name } });
      },
    };
  },
};
