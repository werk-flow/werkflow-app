// Product-UI lint rules (design canon, werkflow-design skill). Each rule
// names the incident or canon rule that motivated it so the why travels with
// the no (decision 0005).

import { relative, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

const SPACED_CONTAINER_CLASS = /(?:^|\s)(?:gap-|space-y-|space-x-|items-center|flex-row|sr-only)/;

function jsxElementName(node) {
  if (!node || node.type !== 'JSXElement') return null;
  const name = node.openingElement.name;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression' && name.property.type === 'JSXIdentifier') {
    return name.property.name;
  }
  return null;
}

function classNameLiteral(node) {
  const attribute = node.openingElement.attributes.find(
    (candidate) =>
      candidate.type === 'JSXAttribute' &&
      candidate.name.type === 'JSXIdentifier' &&
      candidate.name.name === 'className',
  );
  if (!attribute || !attribute.value) return null;
  if (attribute.value.type === 'Literal') return String(attribute.value.value);
  if (attribute.value.type === 'JSXExpressionContainer') {
    const expression = attribute.value.expression;
    if (expression.type === 'Literal') return String(expression.value);
    if (expression.type === 'TemplateLiteral') {
      return expression.quasis.map((quasi) => quasi.value.raw).join(' ');
    }
    // cn(...) and friends: collect every string literal argument.
    if (expression.type === 'CallExpression') {
      return expression.arguments.flatMap((argument) => collectStringLiterals(argument)).join(' ');
    }
  }
  return null;
}

function collectStringLiterals(node) {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral') return node.quasis.map((quasi) => quasi.value.raw);
  if (node.type === 'LogicalExpression') {
    return [...collectStringLiterals(node.left), ...collectStringLiterals(node.right)];
  }
  if (node.type === 'ConditionalExpression') {
    return [...collectStringLiterals(node.consequent), ...collectStringLiterals(node.alternate)];
  }
  return [];
}

/**
 * A `<Label>` must sit inside `Field` (the canonical stack) or inside a
 * container whose className spaces its children (`gap-*`, `space-y-*`,
 * `items-center` for inline checkbox rows). A `Label` in a bare `div` renders
 * glued to its control — the 2026-09-03 regression in the P1-13/P1-15 forms.
 */
const labelInSpacedContainerRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      useField:
        'Label-plus-control stacks use Field so naming, required state and errors stay connected (werkflow-design: every field is a Field).',
      bareContainer:
        '<Label> sits in a container with no spacing, so it touches its control. Use <Field label=...> from components/ui/field (design canon: every field is a Field), or give the container gap-2 / space-y-2.',
    },
  },
  create(context) {
    const controlNames = new Set([
      'Input',
      'Textarea',
      'Select',
      'SearchableSelect',
      'SearchableMultiSelect',
      'DatePicker',
      'TimeInput',
      'DurationHoursInput',
      'QuantityStepper',
      'DateTimeField',
      'input',
      'textarea',
      'select',
    ]);
    function containsUnownedControl(node) {
      if (!node || typeof node !== 'object') return false;
      const name = jsxElementName(node);
      if (name === 'Field') return false;
      if (controlNames.has(name)) return true;
      return (context.sourceCode.visitorKeys[node.type] ?? []).some((key) => {
        const child = node[key];
        return Array.isArray(child) ? child.some(containsUnownedControl) : containsUnownedControl(child);
      });
    }
    return {
      JSXElement(node) {
        if (jsxElementName(node) !== 'Label') return;
        for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
          if (jsxElementName(ancestor) === 'Field') return;
        }
        let parent = node.parent;
        while (parent && (parent.type === 'JSXFragment' || parent.type === 'JSXExpressionContainer')) {
          parent = parent.parent;
        }
        if (!parent || parent.type !== 'JSXElement') return;
        const parentName = jsxElementName(parent);
        if (parentName === 'Field') return;
        if (parent.children.some((child) => child !== node && containsUnownedControl(child))) {
          context.report({ node: node.openingElement, messageId: 'useField' });
          return;
        }
        const classes = classNameLiteral(parent);
        if (classes !== null && SPACED_CONTAINER_CLASS.test(classes)) return;
        // A Label that wraps its control (checkbox rows) is fine: the label is
        // the container. Only report when the Label is a sibling of a control.
        const siblings = parent.children.filter(
          (child) => child.type === 'JSXElement' || child.type === 'JSXExpressionContainer',
        );
        if (siblings.length < 2) return;
        context.report({ node: node.openingElement, messageId: 'bareContainer' });
      },
    };
  },
};

/**
 * Lucide icons take the global 1.75 stroke from app/globals.css; a strokeWidth
 * prop per icon drifts the weight (werkflow-design: Icons). SVG primitives
 * such as the progress ring's own <circle> keep the attribute.
 */
const noLucideStrokeWidthRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      strokeWidth:
        'Lucide icons take the global 1.75 stroke from app/globals.css; drop the strokeWidth prop (werkflow-design skill: Icons). A deliberate exception uses a utility class such as [stroke-width:3].',
    },
  },
  create(context) {
    const lucideIcons = new Set();
    const lucideNamespaces = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'lucide-react') return;
        for (const specifier of node.specifiers) {
          (specifier.type === 'ImportNamespaceSpecifier' ? lucideNamespaces : lucideIcons).add(
            specifier.local.name,
          );
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'strokeWidth') return;
        const name = node.parent.name;
        const isLucide =
          (name.type === 'JSXIdentifier' && lucideIcons.has(name.name)) ||
          (name.type === 'JSXMemberExpression' &&
            name.object.type === 'JSXIdentifier' &&
            lucideNamespaces.has(name.object.name));
        if (isLucide) context.report({ node, messageId: 'strokeWidth' });
      },
    };
  },
};

// `disabled` and `Button pending` both disable the control, so both answer
// to the pending-only rules below.
function disablingExpressions(openingElement) {
  return ['disabled', 'pending']
    .map((name) => jsxAttribute(openingElement, name))
    .filter((attribute) => attribute?.value?.type === 'JSXExpressionContainer');
}

function jsxAttribute(openingElement, name) {
  return openingElement.attributes.find(
    (candidate) =>
      candidate.type === 'JSXAttribute' &&
      candidate.name.type === 'JSXIdentifier' &&
      candidate.name.name === name,
  );
}

function staticAttributeValue(attribute) {
  if (!attribute || !attribute.value) return null;
  if (attribute.value.type === 'Literal') return String(attribute.value.value);
  if (attribute.value.type === 'JSXExpressionContainer' && attribute.value.expression.type === 'Literal') {
    return String(attribute.value.expression.value);
  }
  return null;
}

// Naming convention for the flags a submit button may be disabled on. A
// pending flag names the running request (isSaving, isPending, submitting,
// busy.isBusy("x"), anyBusy, isLoading). An availability flag names an action
// that does not exist right now, not a field the user still has to fill
// (formDisabled, readOnly, !hydrated, !canEdit). A `*Dirty` flag keeps its
// name in a local condition, but a submit never waits on it: a save without a
// change stays pressable and says there is nothing to save (the settings
// saves, walkthrough of 2026-10).
const PENDING_FLAG =
  /pending|busy|saving|submitting|loading|sending|deleting|uploading|working|resetting|redirecting|starting|previewing|adding|challenging|resolving|refreshing|extending|creating|importing/i;
const AVAILABILITY_FLAG = /disabled$|^readOnly$|^hydrated$|^canEdit$|dirty$/i;
const SUBMIT_AVAILABILITY_FLAG = /disabled$|^readOnly$|^hydrated$|^canEdit$/i;

const CONDITION_TYPES = new Set([
  'LogicalExpression',
  'UnaryExpression',
  'BinaryExpression',
  'ConditionalExpression',
]);

function isHookCall(node, hookName) {
  if (node?.type !== 'CallExpression') return false;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === hookName;
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === hookName
  );
}

// The value an arrow function computes: its expression body, or the argument
// of a body that is a single `return`.
function arrowResult(node) {
  if (node?.type !== 'ArrowFunctionExpression') return null;
  if (node.body.type !== 'BlockStatement') return node.body;
  const [statement] = node.body.body;
  return node.body.body.length === 1 && statement.type === 'ReturnStatement' ? statement.argument : null;
}

// What a const computes when the rules can read it: a condition, the result
// of `useMemo(() => <condition>, deps)`, or an arrow's result (`const
// canSubmit = () => ...` called as `canSubmit()`). The useMemo `canSubmit` of
// the dispatch dialog hid its gate from both rules (UI audit of 2026-10-17).
function computedCondition(init) {
  if (CONDITION_TYPES.has(init?.type)) return init;
  if (isHookCall(init, 'useMemo')) return arrowResult(init.arguments[0]);
  return arrowResult(init);
}

// A flag computed in the same file (`const submitDisabled = submitting ||
// reason.trim().length < 8`, a `useMemo` over the same condition) is judged
// by the condition it computes, so a `*Disabled` or neutral name cannot hide
// a validation hint. A pending name, a named availability flag (canEdit,
// readOnly, hydrated, *Dirty), a prop, a hook result and a destructured value
// keep their name; a `*Disabled` prop is judged where the parent passes it.
function conditionResolver(context) {
  const seen = new Set();
  return (identifier) => {
    const { name } = identifier;
    if (PENDING_FLAG.test(name) || seen.has(name)) return null;
    if (AVAILABILITY_FLAG.test(name) && !/disabled$/i.test(name)) return null;
    for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
      const variable = scope.set.get(name);
      if (!variable) continue;
      const [definition] = variable.defs;
      if (
        variable.defs.length !== 1 ||
        definition.type !== 'Variable' ||
        definition.parent.kind !== 'const' ||
        definition.node.id.type !== 'Identifier'
      )
        return null;
      const condition = computedCondition(definition.node.init);
      if (!condition) return null;
      seen.add(name);
      return condition;
    }
    return null;
  };
}

// The value of a local `const [value, setValue] = useState(...)`: what the
// user typed or chose in this component.
function isLocalStateValue(identifier, context) {
  for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (!variable) continue;
    const [definition] = variable.defs;
    return (
      variable.defs.length === 1 &&
      definition.type === 'Variable' &&
      definition.node.id.type === 'ArrayPattern' &&
      definition.node.id.elements[0] === definition.name &&
      isHookCall(definition.node.init, 'useState')
    );
  }
  return false;
}

function referencedFlagNames(node, resolve, names = []) {
  if (!node || typeof node !== 'object') return names;
  switch (node.type) {
    case 'Identifier': {
      const condition = resolve(node);
      if (condition) return referencedFlagNames(condition, resolve, names);
      names.push(node.name);
      return names;
    }
    case 'MemberExpression':
      // `form.formState.isDirty` and `busy.anyBusy` are named by their last segment.
      names.push(!node.computed && node.property.type === 'Identifier' ? node.property.name : '<computed>');
      return names;
    case 'CallExpression':
      // `Boolean(isSaving)` only coerces: the wrapped expression names the flag.
      if (node.callee.type === 'Identifier' && node.callee.name === 'Boolean' && node.arguments.length === 1)
        return referencedFlagNames(node.arguments[0], resolve, names);
      // `busy.isBusy("state")`: the callee names the flag, the arguments select it.
      return referencedFlagNames(node.callee, resolve, names);
    case 'Literal':
      return names;
    case 'UnaryExpression':
      return referencedFlagNames(node.argument, resolve, names);
    case 'LogicalExpression':
    case 'BinaryExpression':
      referencedFlagNames(node.left, resolve, names);
      return referencedFlagNames(node.right, resolve, names);
    case 'ConditionalExpression':
      referencedFlagNames(node.test, resolve, names);
      referencedFlagNames(node.consequent, resolve, names);
      return referencedFlagNames(node.alternate, resolve, names);
    default:
      names.push('<expression>');
      return names;
  }
}

/**
 * "The submit button is never disabled as a validation hint" (design canon,
 * Forms and Enter): a disabled submit makes the user hunt for the missing
 * field and is skipped by keyboard and screen readers. It stays enabled and
 * the submit handler marks the fields through `Field error` and focuses the
 * first one (`focusFirstInvalidField`, lib/ui/field-validation). About forty
 * buttons gated on `reason.trim().length < 3` or `!selectedId` were converted
 * on 2026-10-01. The named exception (at most two obvious required fields)
 * carries an inline disable with its reason.
 */
const submitDisabledOnlyWhilePendingRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      validationHint:
        "A submit button is disabled only while its request is pending. `{{name}}` is not a pending or availability flag (PENDING_FLAG / SUBMIT_AVAILABILITY_FLAG in eslint-rules/ui-rules.mjs): keep the button enabled; on submit, show the missing field through Field's `error` and focus it, or say that there is nothing to save (werkflow-design skill: Forms and Enter).",
    },
  },
  create(context) {
    const report = (expression, node) => {
      const offending = referencedFlagNames(expression, conditionResolver(context)).find(
        (name) => !PENDING_FLAG.test(name) && !SUBMIT_AVAILABILITY_FLAG.test(name),
      );
      if (offending) context.report({ node, messageId: 'validationHint', data: { name: offending } });
    };
    return {
      JSXOpeningElement(node) {
        // A form component's `submitDisabled` prop ends on its submit button:
        // judge it where the parent computes it.
        for (const attribute of disabledProps(node, /^submit[A-Z]?\w*Disabled$/))
          report(attribute.value.expression, attribute);
        if (node.name.type !== 'JSXIdentifier' || !/^(Button|button|PlainButton)$/.test(node.name.name))
          return;
        if (staticAttributeValue(jsxAttribute(node, 'type')) !== 'submit') return;
        for (const disabled of disablingExpressions(node)) report(disabled.value.expression, disabled);
      },
    };
  },
};

// The `*Disabled` props a parent passes to a component (`<ReasonForm
// submitDisabled={!reason.trim()} />`): the component trusts its prop name, so
// the rules judge the value at the call site.
function disabledProps(openingElement, pattern) {
  const { name } = openingElement;
  const isComponent =
    (name.type === 'JSXIdentifier' && /^[A-Z]/.test(name.name)) || name.type === 'JSXMemberExpression';
  if (!isComponent) return [];
  return openingElement.attributes.filter(
    (attribute) =>
      attribute.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      pattern.test(attribute.name.name) &&
      attribute.value?.type === 'JSXExpressionContainer',
  );
}

const COUNT_COMPARISON = new Set(['===', '==', '!==', '!=', '<', '<=', '>', '>=']);
const COUNT_NAME = /(count|length|size)$/i;

function countOperand(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier')
    return node.property.name;
  return null;
}

function isInputCount(node) {
  const name = countOperand(node);
  return name !== null && COUNT_NAME.test(name) && !PENDING_FLAG.test(name);
}

// `items.length === 0`, `!items.length`, `ids.size < 1`, `changeCount === 0`,
// and the positive spellings a `canSubmit` uses (`items.length > 0`): the
// button waits for something to be chosen or entered. A running count
// (`uploadingCount > 0`) is a pending flag.
function emptinessCheck(node) {
  if (node.type === 'UnaryExpression' && node.operator === '!') return isInputCount(node.argument);
  if (node.type !== 'BinaryExpression' || !COUNT_COMPARISON.has(node.operator)) return false;
  if (node.right.type !== 'Literal' || (node.right.value !== 0 && node.right.value !== 1)) return false;
  return isInputCount(node.left);
}

// `!file`, `file === null`, `value === ''` over a local useState value: a
// field the user still has to fill. The positive spelling a `canSubmit` uses
// (`file !== null`) counts too, as `items.length > 0` does for counts.
function missingStateValue(node, context) {
  const operand =
    node.type === 'UnaryExpression' && node.operator === '!'
      ? node.argument
      : node.type === 'BinaryExpression' &&
          ['===', '==', '!==', '!='].includes(node.operator) &&
          ((node.right.type === 'Literal' && (node.right.value === null || node.right.value === '')) ||
            (node.right.type === 'Identifier' && node.right.name === 'undefined'))
        ? node.left
        : null;
  if (operand?.type !== 'Identifier') return false;
  if (PENDING_FLAG.test(operand.name) || AVAILABILITY_FLAG.test(operand.name)) return false;
  return isLocalStateValue(operand, context);
}

// Form input the user still has to provide: typed text (`reason.trim()`), a
// choice (`selectedId`, `selectedDocumentIds.size`), an empty collection or
// count, or an unset local state value, also behind a local condition
// (`const missingReason = !reason.trim()`) or a `useMemo`.
function validityInput(node, resolve, context) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'Identifier' && /^selected($|[A-Z])/.test(node.name)) return node.name;
  if (node.type === 'Identifier') return validityInput(resolve(node), resolve, context);
  if (emptinessCheck(node) || missingStateValue(node, context)) return context.sourceCode.getText(node);
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    /^selected($|[A-Z])/.test(node.property.name)
  )
    return node.property.name;
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'trim'
  )
    return '.trim()';
  for (const key of ['object', 'callee', 'argument', 'left', 'right', 'test', 'consequent', 'alternate']) {
    // A value whose member is read (`activeRows.length`) is data, not a flag:
    // only its own name can say it is a choice.
    if (key === 'object' && node.object?.type === 'Identifier') {
      if (/^selected($|[A-Z])/.test(node.object.name)) return node.object.name;
      continue;
    }
    const found = validityInput(node[key], resolve, context);
    if (found) return found;
  }
  for (const argument of node.type === 'CallExpression' ? node.arguments : []) {
    const found = validityInput(argument, resolve, context);
    if (found) return found;
  }
  return null;
}

/**
 * The submit rule's sibling for action buttons (`onClick`, no `type="submit"`):
 * a dialog's "Verknüpfen", "Hinzufügen" or "Speichern" disabled until a
 * choice is made or a reason is typed hides what is missing just like a
 * disabled submit (CodeRabbit review of 2026-10-03: the promote, match,
 * link, add-requirement and project-assignment buttons). The button stays
 * enabled, the click marks the field and focuses it (`focusFirstInvalidField`).
 * A batch bar that acts on the current selection may disable on an empty
 * selection, with an inline disable that names the reason.
 */
const actionDisabledOnlyWhilePendingRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      validationHint:
        "An action button is disabled only while its request is pending. `{{input}}` is form input the user still has to provide: keep the button enabled, mark the field through Field's `error` and focus it on click (werkflow-design skill: Forms and Enter).",
    },
  },
  create(context) {
    const report = (expression, node) => {
      const input = validityInput(expression, conditionResolver(context), context);
      if (input) context.report({ node, messageId: 'validationHint', data: { input } });
    };
    return {
      JSXOpeningElement(node) {
        // `saveDisabled`, `actionDisabled` and the like end on a component's
        // action button; the submit rule judges `submit*Disabled`.
        for (const attribute of disabledProps(node, /^(?!submit)[a-z]\w*Disabled$/))
          report(attribute.value.expression, attribute);
        if (node.name.type !== 'JSXIdentifier' || !/^(Button|button|PlainButton)$/.test(node.name.name))
          return;
        if (staticAttributeValue(jsxAttribute(node, 'type')) === 'submit') return;
        for (const disabled of disablingExpressions(node)) report(disabled.value.expression, disabled);
      },
    };
  },
};

/** An empty or valueless `aria-label` names nothing; a dynamic value is trusted. */
function namesElement(attribute) {
  if (!attribute || !attribute.value) return false;
  const staticValue = staticAttributeValue(attribute);
  return staticValue === null || staticValue.trim() !== '';
}

/**
 * An icon-only button has no text, so its accessible name must come from a
 * German `aria-label` (design canon: Accessibility). Unnamed remove and clear
 * controls in the Aufträge filter bar were announced as "Schaltfläche"
 * (UI audit, 2026-10-01). A spread cannot be verified to name the button,
 * so it never counts as a name.
 */
const iconButtonNeedsNameRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      unnamed:
        'An icon-only Button (size="{{size}}") needs a German aria-label naming its action (werkflow-design skill: Accessibility).',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'Button') return;
        const size = staticAttributeValue(jsxAttribute(node, 'size'));
        if (!size || !size.startsWith('icon')) return;
        if (
          namesElement(jsxAttribute(node, 'aria-label')) ||
          namesElement(jsxAttribute(node, 'aria-labelledby'))
        )
          return;
        // A visually hidden text child names the button as well.
        const children = node.parent.type === 'JSXElement' ? node.parent.children : [];
        if (
          children.some(
            (child) => child.type === 'JSXElement' && /\bsr-only\b/.test(classNameLiteral(child) ?? ''),
          )
        )
          return;
        context.report({ node, messageId: 'unnamed', data: { size } });
      },
    };
  },
};

/**
 * Raw `<button>` and raw text `<input>` are registry-owned (components/ui):
 * `Button` or `PlainButton` set the type and the focus ring, `Input` inside
 * `Field` carries the label, the error and the ARIA wiring. 63 raw buttons
 * without a type and one unlabeled raw search input were converted on
 * 2026-10-01. File pickers and hidden form values stay raw.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password']);

const noRawControlsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      button:
        'Raw <button> outside components/ui: use Button for an action or PlainButton (components/ui/plain-button) for a clickable region. Both set the type and the focus ring.',
      input:
        'Raw text <input> outside components/ui: use Input inside Field (components/ui/input, components/ui/field). Only file and hidden inputs stay raw.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        if (node.name.name === 'button') {
          context.report({ node, messageId: 'button' });
          return;
        }
        if (node.name.name !== 'input') return;
        // The other native types (date, number, checkbox, ...) have their own
        // registry bans; a dynamic type is left to review.
        const typeAttribute = jsxAttribute(node, 'type');
        const type = staticAttributeValue(typeAttribute);
        // An empty static type falls back to text in the browser.
        if (typeAttribute ? type === '' || TEXT_INPUT_TYPES.has(type) : true)
          context.report({ node, messageId: 'input' });
      },
    };
  },
};

/**
 * A `<p>` holds phrasing content only. The HTML parser closes an open
 * paragraph at the start tag of a block element, so the browser's DOM no
 * longer matches the server markup and React cannot hydrate it: a skeleton
 * `div` inside a `p` raised React #418 on the approvals tab (2026-10-02).
 * The registry components listed here render a block element themselves.
 */
const BLOCK_ELEMENTS = new Set([
  'div',
  'p',
  'ul',
  'ol',
  'table',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'blockquote',
  'hr',
  'dl',
  'figure',
  'Skeleton',
  'Card',
  'ErrorText',
  'SectionError',
  'EmptyState',
  'Field',
]);

const noBlockInParagraphRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      blockInParagraph:
        '<{{name}}> renders a block element inside a <p>: the HTML parser closes the paragraph and the server markup no longer hydrates. Use a <div> for the outer element or a <span> inside.',
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        const name = jsxElementName(node);
        if (!name || !BLOCK_ELEMENTS.has(name)) return;
        // The nearest enclosing block decides: report only the outermost block inside a <p>.
        for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
          if (ancestor.type === 'JSXAttribute') return;
          const ancestorName = jsxElementName(ancestor);
          if (!ancestorName || !BLOCK_ELEMENTS.has(ancestorName)) continue;
          if (ancestorName === 'p') context.report({ node, messageId: 'blockInParagraph', data: { name } });
          return;
        }
      },
    };
  },
};

// A setter of a pending flag: setIsSaving, setBusy, setDeleting.
const PENDING_SETTER =
  /^set(?=[A-Z])\w*?(?:Pending|Busy|Loading|Saving|Submitting|Deleting|Sending|Uploading|Removing|Creating|Updating|Working)\w*$/;

function isFunctionNode(node) {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function pendingFlagCall(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return null;
  if (!PENDING_SETTER.test(node.callee.name) || node.arguments.length !== 1) return null;
  const [argument] = node.arguments;
  if (argument.type !== 'Literal' || typeof argument.value !== 'boolean') return null;
  return { name: node.callee.name, value: argument.value, node };
}

// The function's own nodes, without the nodes of nested functions.
function ownNodes(fn, visitorKeys) {
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (isFunctionNode(node)) return;
    nodes.push(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(fn.body);
  return nodes;
}

function containsNode(outer, inner) {
  return Boolean(outer) && inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

function isCatchCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'catch'
  );
}

// A callback whose call result is chained into `.catch(...)` rejects into that
// handler (`busy.run(id, async () => …).catch(…)`), which owns the failure.
function rejectionCaughtByChain(fn) {
  let call = fn.parent;
  if (call?.type !== 'CallExpression' || !call.arguments.includes(fn)) return false;
  while (call.parent?.type === 'MemberExpression' && call.parent.object === call) {
    const member = call.parent;
    if (member.parent?.type !== 'CallExpression' || member.parent.callee !== member) return false;
    if (isCatchCall(member.parent)) return true;
    call = member.parent;
  }
  return false;
}

/**
 * A pending flag set before an await and reset only on the success path stays
 * true when the call rejects: the control spins forever and blocks a retry or
 * the dialog close (CodeRabbit review of 2026-10-03: the schedule, condition,
 * personnel and vacation forms and the member actions). The reset belongs in a
 * `finally`, or in the `catch` as well as after the await.
 */
const pendingResetOnFailureRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      successOnlyReset:
        '`{{name}}(true)` is reset only after an await that can reject, so the control stays pending when the call fails. Reset it in a `finally`, or in the `catch` as well (werkflow-design skill: No silent failures).',
    },
  },
  create(context) {
    function check(fn) {
      if (!fn.body || fn.body.type !== 'BlockStatement' || rejectionCaughtByChain(fn)) return;
      const nodes = ownNodes(fn, context.sourceCode.visitorKeys);
      const flags = nodes.map(pendingFlagCall).filter(Boolean);
      // `await x.catch(…)` cannot reject.
      const awaits = nodes.filter((node) => node.type === 'AwaitExpression' && !isCatchCall(node.argument));
      const tries = nodes.filter((node) => node.type === 'TryStatement');
      for (const start of flags.filter((flag) => flag.value)) {
        const resets = flags.filter(
          (flag) => !flag.value && flag.name === start.name && flag.node.range[0] > start.node.range[0],
        );
        if (resets.length === 0) continue;
        const resetsIn = (block) => resets.some((reset) => containsNode(block, reset.node));
        const lastReset = Math.max(...resets.map((reset) => reset.node.range[0]));
        const unprotected = awaits.some(
          (awaitNode) =>
            awaitNode.range[0] > start.node.range[0] &&
            awaitNode.range[0] < lastReset &&
            !tries.some(
              (tryNode) =>
                containsNode(tryNode.block, awaitNode) &&
                (resetsIn(tryNode.finalizer) || resetsIn(tryNode.handler)),
            ),
        );
        if (unprotected)
          context.report({ node: start.node, messageId: 'successOnlyReset', data: { name: start.name } });
      }
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};

function isCaptureOption(node) {
  if (!node) return false;
  if (node.type === 'Literal') return node.value === true;
  return (
    node.type === 'ObjectExpression' &&
    node.properties.some(
      (property) =>
        property.type === 'Property' &&
        property.key.type === 'Identifier' &&
        property.key.name === 'capture' &&
        property.value.type === 'Literal' &&
        property.value.value === true,
    )
  );
}

function resolveFunction(node, scope) {
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return node;
  if (node.type !== 'Identifier') return null;
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(node.name);
    if (!variable) continue;
    const definition = variable.defs[0]?.node;
    if (definition?.type === 'FunctionDeclaration') return definition;
    if (definition?.type === 'VariableDeclarator') return definition.init ?? null;
    return null;
  }
  return null;
}

/**
 * A page-wide keydown listener (`window` or `document`, bubble phase) runs
 * after every dialog, menu and drag that handled the same key, so it must skip
 * a key they consumed (`event.defaultPrevented`): Escape that cancelled a drag
 * also closed the Parkplatz panel, and Escape that closed the account menu
 * also closed the mobile drawer (third review pass and the follow-up sweep).
 * A capture-phase listener runs first and owns the key instead.
 */
const globalKeyHandlerRespectsConsumedRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      consumedKey:
        'A bubble-phase keydown listener on `{{target}}` must return when `event.defaultPrevented` is true: a dialog, menu or drag that already handled the key consumed it (werkflow-design skill: Interaction canon).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'addEventListener' ||
          callee.object.type !== 'Identifier' ||
          !['window', 'document'].includes(callee.object.name)
        )
          return;
        const [type, listener, options] = node.arguments;
        if (type?.type !== 'Literal' || type.value !== 'keydown' || !listener || isCaptureOption(options))
          return;
        const handler = resolveFunction(listener, context.sourceCode.getScope(node));
        if (handler && context.sourceCode.getText(handler).includes('defaultPrevented')) return;
        context.report({ node, messageId: 'consumedKey', data: { target: callee.object.name } });
      },
    };
  },
};

// A flag that names a running write. Reads (loading, refreshing, previewing,
// searching) stay out: a dialog that waits for its options must still close.
const WRITE_PENDING_FLAG =
  /pending|busy|saving|submitting|sending|deleting|uploading|working|resetting|creating|importing|adding|removing|updating|applying|linking|confirming|running|starting|redirecting/i;
const READ_FLAG = /load|refresh|preview|search|settl/i;

// A progressive flag names a running operation too (isDissolving, isArchiving).
const PROGRESSIVE_FLAG = /^is[A-Z]\w*ing$/;
const UI_STATE_FLAG = /editing|dragging|hovering|showing|opening|closing/i;

// A setter (setPendingAction) writes the flag; only a read guards a close.
function isWritePendingName(name) {
  if (/^set[A-Z]/.test(name) || READ_FLAG.test(name) || UI_STATE_FLAG.test(name)) return false;
  return WRITE_PENDING_FLAG.test(name) || PROGRESSIVE_FLAG.test(name);
}

function identifierNames(node, visitorKeys, names = []) {
  if (!node || typeof node.type !== 'string') return names;
  if (node.type === 'Identifier') names.push(node.name);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((item) => identifierNames(item, visitorKeys, names));
    else identifierNames(child, visitorKeys, names);
  }
  return names;
}

// A local function or function-valued const; a parameter (a handler the
// parent passed in) resolves to nothing.
function localFunction(node, scope) {
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return node;
  if (node.type !== 'Identifier') return null;
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(node.name);
    if (!variable) continue;
    const [definition] = variable.defs;
    if (definition?.type === 'FunctionName') return definition.node;
    const init = definition?.type === 'Variable' ? definition.node.init : null;
    return init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
      ? init
      : null;
  }
  return null;
}

function containsAwait(node, visitorKeys) {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'AwaitExpression') return true;
  return (visitorKeys[node.type] ?? []).some((key) => {
    const child = node[key];
    return Array.isArray(child)
      ? child.some((item) => containsAwait(item, visitorKeys))
      : containsAwait(child, visitorKeys);
  });
}

const DIALOG_ROOTS = new Set(['Dialog', 'AlertDialog']);

/**
 * A dialog that waits for its server answer passes `pending` to its root:
 * `Dialog` and `AlertDialog` then refuse Escape, an outside click, the X
 * button and Cancel until the result lands, so a failure cannot hit a closed
 * dialog (werkflow-design skill: Dialog close and success). Hand-written
 * `onOpenChange` guards left the X enabled while the request ran (the evidence,
 * work-template, lifecycle and personnel dialogs, 2026-10-04). The rule
 * reports a root without `pending` whose `onOpenChange` reads a pending flag,
 * whose controls are disabled by a write's pending flag, or whose confirm
 * action awaits.
 */
const dialogPendingWhileWaitingRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      guard:
        '<{{name}}> guards `onOpenChange` on `{{flag}}` by hand, which leaves the close button enabled. Pass `pending={…}` to the root and drop the guard (werkflow-design skill: Dialog close and success).',
      waits:
        '<{{name}}> waits for a request (`{{flag}}`) but has no `pending` prop, so Escape, an outside click and the close button can close it before the answer lands. Pass `pending={…}` bound to the running request (werkflow-design skill: Dialog close and success).',
    },
  },
  create(context) {
    const { visitorKeys } = context.sourceCode;
    function pendingNameIn(node) {
      return identifierNames(node, visitorKeys).find(isWritePendingName) ?? null;
    }
    // The first write flag or awaiting confirm inside the dialog, without nested dialogs.
    function waitingSignal(element, resolve) {
      let found = null;
      const visit = (node) => {
        if (found || !node || typeof node.type !== 'string') return;
        const elementName = jsxElementName(node) ?? '';
        // A nested dialog answers for itself; the trigger opens the dialog and may spin for a
        // request that runs after a confirmation closed it at once.
        if (node !== element && (DIALOG_ROOTS.has(elementName) || elementName.endsWith('Trigger'))) return;
        if (node.type === 'JSXOpeningElement') {
          for (const disabled of disablingExpressions(node)) {
            const flag = referencedFlagNames(disabled.value.expression, resolve).find(isWritePendingName);
            if (flag && !found) found = flag;
          }
          const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
          const onClick = jsxAttribute(node, 'onClick');
          if (!found && name === 'AlertDialogAction' && onClick?.value?.type === 'JSXExpressionContainer') {
            const handler = localFunction(onClick.value.expression, context.sourceCode.getScope(node));
            if (handler && (handler.async || containsAwait(handler.body, visitorKeys)))
              found = 'await in AlertDialogAction';
          }
        }
        for (const key of visitorKeys[node.type] ?? []) {
          const child = node[key];
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
      };
      visit(element);
      return found;
    }
    return {
      JSXElement(node) {
        const name = jsxElementName(node);
        if (!DIALOG_ROOTS.has(name ?? '') || node.openingElement.name.type !== 'JSXIdentifier') return;
        const opening = node.openingElement;
        if (jsxAttribute(opening, 'pending')) return;
        if (opening.attributes.some((attribute) => attribute.type === 'JSXSpreadAttribute')) return;
        const onOpenChange = jsxAttribute(opening, 'onOpenChange');
        if (onOpenChange?.value?.type === 'JSXExpressionContainer') {
          const handler = localFunction(onOpenChange.value.expression, context.sourceCode.getScope(opening));
          const flag = handler ? pendingNameIn(handler.body) : null;
          if (flag) {
            context.report({ node: opening, messageId: 'guard', data: { name, flag } });
            return;
          }
        }
        const flag = waitingSignal(node, conditionResolver(context));
        if (flag) context.report({ node: opening, messageId: 'waits', data: { name, flag } });
      },
    };
  },
};

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
// Globals a derivation may read without touching an external system.
const PURE_GLOBALS = new Set([
  'undefined',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'Set',
  'Map',
  'NaN',
  'Infinity',
  'Date',
]);

function calledHookName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier')
    return callee.property.name;
  return null;
}

function findScopeVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
}

function hookCallDefinition(variable, hook) {
  const [definition] = variable?.defs ?? [];
  if (definition?.type !== 'Variable') return null;
  const { init } = definition.node;
  return init?.type === 'CallExpression' && calledHookName(init.callee) === hook ? definition.node : null;
}

// `const [value, setValue] = useState(…)`: the variable is the setter.
function isStateSetter(variable) {
  const declarator = hookCallDefinition(variable, 'useState');
  return (
    declarator?.id.type === 'ArrayPattern' &&
    declarator.id.elements[1]?.type === 'Identifier' &&
    declarator.id.elements[1].name === variable.name
  );
}

function rangeWithin(outer, inner) {
  return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

function isPropertyName(node) {
  const parent = node.parent;
  if (parent?.type === 'MemberExpression') return parent.property === node && !parent.computed;
  if (parent?.type === 'Property') return parent.key === node && !parent.computed && !parent.shorthand;
  return false;
}

function isCurrentRead(node) {
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === 'current'
  );
}

// `Date.now()` and `new Date()`: the wall clock, read during the effect.
function isClockRead(node) {
  if (node.type === 'NewExpression')
    return node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0;
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'Date' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'now'
  );
}

// `const ref = useRef(value)` whose `.current` is only read or given `value`
// again: the latest-callback ref, a mirror of one render value.
function isMirrorRef(variable) {
  const declarator = hookCallDefinition(variable, 'useRef');
  if (!declarator || declarator.init.arguments.length !== 1) return false;
  const [initial] = declarator.init.arguments;
  if (initial.type !== 'Identifier') return false;
  return variable.references.every((reference) => {
    if (reference.init) return true;
    const member = reference.identifier.parent;
    if (member?.type !== 'MemberExpression' || member.object !== reference.identifier) return false;
    if (!isCurrentRead(member)) return false;
    const use = member.parent;
    if (use?.type === 'UpdateExpression') return false;
    if (use?.type === 'UnaryExpression' && use.operator === 'delete') return false;
    if (use?.type !== 'AssignmentExpression' || use.left !== member) return true;
    return use.operator === '=' && use.right.type === 'Identifier' && use.right.name === initial.name;
  });
}

/**
 * An effect that only copies props or state into state (`useEffect(() =>
 * setLiveJob(job), [job])`) renders twice for every change, and inside a
 * hydrated Suspense boundary its update can starve behind a route transition
 * while React rebases every later update into a new value: an effect keyed on
 * that value then commits forever (the render loop that kept the processor
 * busy, `tests/ui-contracts/hydration-settle.spec.ts`).
 * `react-hooks/set-state-in-effect` misses exactly this shape: the compiler's
 * derived-computation check matches it first and throws, and the plugin drops
 * that finding because `react-hooks/no-deriving-state-in-effects` is off; the
 * throw also skips every other compiler check of that component. The compiler
 * also skips a whole component that suppresses a `react-hooks` rule. Derive the
 * value during render, or adopt a changed prop during render with a tracked
 * previous value. Setter calls behind `if` guards count, and so do local
 * `const` declarations that feed them and updater functions
 * (`setX((current) => f(current, job))`); a constant reset is left to
 * `set-state-in-effect`.
 *
 * Refs: a ref whose `.current` only ever receives the value it was created
 * with (`const getIdRef = useRef(getId)`, `getIdRef.current = getId`) mirrors
 * a render value, the latest-callback pattern, so reading it is reading props.
 * Any other ref (a DOM node, a timer, a value an event or a fetch wrote, a ref
 * handed to JSX or a function) holds external state and makes the effect real
 * synchronisation.
 *
 * The clock: an effect that seeds state from `Date.now()` or `new Date()`
 * shows a false value in the first frame. Seed in render with a lazy
 * `useState` initializer, or read `useMountedWallClockTick`, and tick in an
 * effect; a timer callback that sets the clock is external synchronisation and
 * passes.
 *
 * `exceptions` names an effect that cannot change yet by its file and its
 * setters, with the reason. The list only shrinks: an entry whose effect no
 * longer reports is itself reported as stale.
 */
const noDerivedStateEffectRule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          exceptions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'setters', 'reason'],
              properties: {
                file: { type: 'string', minLength: 1 },
                setters: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
                reason: { type: 'string', minLength: 20 },
              },
            },
          },
        },
      },
    ],
    messages: {
      staleException:
        'The no-derived-state-effect exception for {{setters}} in this file no longer matches an effect: remove it from the rule options in eslint.config.mjs.',
      derived:
        'This effect only copies props or state into state ({{setters}}). Derive the value during render, or adopt a changed prop during render with a tracked previous value (docs/technical/realtime-and-caching.md, Checklist): an effect update can starve under hydration scheduling and loop.',
      clockSeed:
        'This effect seeds state from the clock ({{setters}}), so the first frame shows a false value. Seed it in render (a lazy useState initializer, or useMountedWallClockTick from hooks/use-wall-clock-tick.ts) and tick in an effect.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const { visitorKeys } = sourceCode;
    const file = relative(REPOSITORY_ROOT, context.filename).replaceAll('\\', '/');
    const exceptions = (context.options[0]?.exceptions ?? [])
      .filter((exception) => exception.file === file)
      .map((exception) => ({ key: exception.setters.join(','), used: false }));
    // An excepted effect is matched by its setters; true when the report is excepted.
    function excepted(setterNames) {
      const exception = exceptions.find(({ key, used }) => !used && key === setterNames.join(','));
      if (exception) exception.used = true;
      return exception !== undefined;
    }
    // A value fed by the owner's props or state or by the clock: no external
    // ref, no external read, no async work. `local` holds the effect's own
    // declarations, whose initializers are judged on their own.
    function feedsFromRender(argument, owner, local) {
      const found = { pure: true, readsOwner: false, readsClock: false };
      const visit = (node) => {
        if (!found.pure || !node || typeof node.type !== 'string') return;
        const verdict = judgeNode(node, argument, owner, local);
        if (verdict === 'impure') found.pure = false;
        if (verdict === 'owner') found.readsOwner = true;
        if (verdict === 'clock') found.readsClock = true;
        if (verdict !== 'descend') return;
        for (const key of visitorKeys[node.type] ?? []) {
          const child = node[key];
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
      };
      visit(argument);
      return found;
    }
    // 'descend' visits the children; every other verdict ends the branch.
    function judgeNode(node, argument, owner, local) {
      if (node.type === 'AwaitExpression' || node.type === 'YieldExpression') return 'impure';
      if (isClockRead(node)) return 'clock';
      if (node.type === 'NewExpression') {
        const constructs = node.callee.type === 'Identifier' ? node.callee.name : '';
        return PURE_GLOBALS.has(constructs) && isGlobalName(node.callee) ? 'descend' : 'impure';
      }
      if (isCurrentRead(node)) {
        const variable =
          node.object.type === 'Identifier'
            ? findScopeVariable(sourceCode.getScope(node), node.object.name)
            : null;
        return variable && isMirrorRef(variable) ? 'owner' : 'impure';
      }
      if (node.type !== 'Identifier' || isPropertyName(node)) return 'descend';
      const variable = findScopeVariable(sourceCode.getScope(node), node.name);
      if (!variable || variable.defs.length === 0) return PURE_GLOBALS.has(node.name) ? 'end' : 'impure';
      if (hookCallDefinition(variable, 'useRef')) return 'impure';
      const declaration = variable.defs[0].node;
      if (rangeWithin(argument, declaration) || rangeWithin(local, declaration)) return 'end';
      return rangeWithin(owner, declaration) ? 'owner' : 'end';
    }
    function isGlobalName(identifier) {
      const variable = findScopeVariable(sourceCode.getScope(identifier), identifier.name);
      return !variable || variable.defs.length === 0;
    }
    return {
      CallExpression(node) {
        if (!EFFECT_HOOKS.has(calledHookName(node.callee) ?? '')) return;
        const [effect] = node.arguments;
        if (!effect || effect.async) return;
        if (effect.type !== 'ArrowFunctionExpression' && effect.type !== 'FunctionExpression') return;
        const owner = sourceCode
          .getAncestors(node)
          .reverse()
          .find((ancestor) =>
            ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(ancestor.type),
          );
        if (!owner) return;
        const calls = [];
        const values = [];
        // Setter calls, optionally behind `if` guards, early returns and local
        // declarations that feed them; anything else is real work.
        const collect = (statement) => {
          if (!statement) return true;
          if (statement.type === 'BlockStatement') return statement.body.every(collect);
          if (statement.type === 'ReturnStatement') return statement.argument === null;
          if (statement.type === 'IfStatement') {
            values.push(statement.test);
            return collect(statement.consequent) && collect(statement.alternate);
          }
          if (statement.type === 'VariableDeclaration') {
            values.push(...statement.declarations.map((declarator) => declarator.init));
            return statement.declarations.every((declarator) => declarator.init);
          }
          const expression = statement.type === 'ExpressionStatement' ? statement.expression : statement;
          if (expression.type !== 'CallExpression' || expression.callee.type !== 'Identifier') return false;
          if (expression.arguments.length !== 1) return false;
          if (!isStateSetter(findScopeVariable(sourceCode.getScope(expression), expression.callee.name)))
            return false;
          calls.push(expression);
          values.push(expression.arguments[0]);
          return true;
        };
        if (!collect(effect.body) || calls.length === 0) return;
        const reads = values.map((value) => feedsFromRender(value, owner, effect));
        if (reads.some((read) => !read.pure)) return;
        const messageId = reads.some((read) => read.readsClock) ? 'clockSeed' : 'derived';
        if (messageId === 'derived' && !reads.some((read) => read.readsOwner)) return;
        const setterNames = calls.map((call) => call.callee.name);
        if (excepted(setterNames)) return;
        const setters = setterNames.map((name) => `\`${name}\``).join(', ');
        context.report({ node, messageId, data: { setters } });
      },
      'Program:exit'(program) {
        for (const { key, used } of exceptions) {
          if (!used) context.report({ node: program, messageId: 'staleException', data: { setters: key } });
        }
      },
    };
  },
};

/**
 * A destructive confirmation (werkflow-design, "Destructive confirmations")
 * holds AlertDialogCancel and AlertDialogAction in its footer and no form:
 * a plain footer button skips the pending guard of the primitives and does
 * not close the confirmation, and a nested form lets Enter submit the
 * destructive step. A button inside AlertDialogAction or AlertDialogCancel
 * (`asChild`) is theirs and passes. Known blind spot: a child component that
 * renders a button inside the footer is not followed.
 */
const ALERT_FOOTER_OWNERS = new Set(['AlertDialogFooter', 'AlertDialogAction', 'AlertDialogCancel']);
const RAW_ACTIONS = new Set(['Button', 'PlainButton', 'button']);

const alertDialogFooterActionsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      rawFooterAction:
        'An AlertDialog footer holds AlertDialogCancel and AlertDialogAction only (werkflow-design: Destructive confirmations); wrap <{{name}}> in one of them with asChild or use them directly.',
      formInConfirmation:
        'An AlertDialog holds no form: Enter must not submit a destructive step (werkflow-design: Destructive confirmations).',
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        const name = jsxElementName(node);
        if (RAW_ACTIONS.has(name)) {
          for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
            const ancestorName = jsxElementName(ancestor);
            if (!ancestorName || !ALERT_FOOTER_OWNERS.has(ancestorName)) continue;
            if (ancestorName === 'AlertDialogFooter')
              context.report({ node, messageId: 'rawFooterAction', data: { name } });
            return;
          }
        }
        if (name === 'form') {
          for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
            const ancestorName = jsxElementName(ancestor);
            if (ancestorName === 'DialogContent' || ancestorName === 'SheetContent') return;
            if (ancestorName === 'AlertDialogContent') {
              context.report({ node, messageId: 'formInConfirmation' });
              return;
            }
          }
        }
      },
    };
  },
};

/** The expression a type assertion or a non-null assertion wraps. */
function withoutTypeWrappers(node) {
  let current = node;
  while (
    current &&
    ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression'].includes(
      current.type,
    )
  )
    current = current.expression;
  return current;
}

/** The key a label lookup reads: `MAP[key]`, `MAP?.[key]` or `map.get(key)`; null for anything else. */
function lookupKey(node) {
  const lookup = node.type === 'ChainExpression' ? node.expression : node;
  if (lookup.type === 'MemberExpression' && lookup.computed) return lookup.property;
  if (
    lookup.type === 'CallExpression' &&
    lookup.callee.type === 'MemberExpression' &&
    !lookup.callee.computed &&
    lookup.callee.property.type === 'Identifier' &&
    lookup.callee.property.name === 'get' &&
    lookup.arguments.length === 1
  )
    return lookup.arguments[0];
  return null;
}

/**
 * "No database id or code reaches the screen" (werkflow-design, Checklist): a
 * label lookup that falls back to the key it looks up (`LABELS[code] ?? code`,
 * `LABELS[code as Kind] || code`, `labels.get(id) ?? id`) shows the raw code
 * the moment a new value appears. Nine such fallbacks showed period states,
 * finding kinds and event types as codes (UI audit 2026-10-15). The fallback
 * is neutral German such as „Änderung dokumentiert“, or none when the value is
 * typed by its union.
 */
const noRawCodeFallbackRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      rawCode:
        'A label lookup falls back to the code `{{code}}` it looks up, so a raw code reaches the screen. Type the map by its union, or fall back to neutral German such as „Änderung dokumentiert“ (werkflow-design skill: Checklist).',
    },
  },
  create(context) {
    const text = (node) => context.sourceCode.getText(withoutTypeWrappers(node));
    return {
      LogicalExpression(node) {
        if (node.operator !== '??' && node.operator !== '||') return;
        const key = lookupKey(withoutTypeWrappers(node.left));
        if (!key) return;
        const code = text(node.right);
        if (text(key) === code) context.report({ node, messageId: 'rawCode', data: { code } });
      },
    };
  },
};

export const uiRules = {
  rules: {
    'no-raw-code-fallback': noRawCodeFallbackRule,
    'label-in-spaced-container': labelInSpacedContainerRule,
    'no-lucide-stroke-width': noLucideStrokeWidthRule,
    'submit-disabled-only-while-pending': submitDisabledOnlyWhilePendingRule,
    'action-disabled-only-while-pending': actionDisabledOnlyWhilePendingRule,
    'icon-button-needs-name': iconButtonNeedsNameRule,
    'no-raw-controls': noRawControlsRule,
    'no-block-in-paragraph': noBlockInParagraphRule,
    'pending-reset-on-failure': pendingResetOnFailureRule,
    'global-key-handler-respects-consumed': globalKeyHandlerRespectsConsumedRule,
    'dialog-pending-while-waiting': dialogPendingWhileWaitingRule,
    'no-derived-state-effect': noDerivedStateEffectRule,
    'alert-dialog-footer-actions': alertDialogFooterActionsRule,
  },
};
