export const noUnscopedPageSelectorsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      getByText:
        'Unscoped Page.getByText hits duplicate responsive renders. Use visibleText()/textInDom() or scope the lookup to its owning region first.',
      locator:
        'Raw page-level selectors couple specs to markup. Use a role/label locator, scope from a semantic container, or move the lookup into a named support helper.',
    },
  },
  create(context) {
    const pageBindings = new Set();
    const pageTypeBindings = new Set(['Page']);
    const playwrightNamespaceBindings = new Set();

    function recordPlaywrightPageImports(node) {
      if (node.source.value !== '@playwright/test') return;
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          playwrightNamespaceBindings.add(specifier.local.name);
          continue;
        }
        if (
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          specifier.imported.name === 'Page'
        ) {
          pageTypeBindings.add(specifier.local.name);
        }
      }
    }

    function isPageTypeAnnotation(annotation) {
      const typeNode = annotation?.type === 'TSTypeAnnotation' ? annotation.typeAnnotation : annotation;
      if (typeNode?.type !== 'TSTypeReference') return false;
      if (typeNode.typeName.type === 'Identifier') {
        return pageTypeBindings.has(typeNode.typeName.name);
      }
      return (
        typeNode.typeName.type === 'TSQualifiedName' &&
        typeNode.typeName.left.type === 'Identifier' &&
        playwrightNamespaceBindings.has(typeNode.typeName.left.name) &&
        typeNode.typeName.right.type === 'Identifier' &&
        typeNode.typeName.right.name === 'Page'
      );
    }

    function recordFunctionPageParameters(node) {
      for (const parameter of node.params) {
        const candidate = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
        if (candidate.type === 'Identifier' && isPageTypeAnnotation(candidate.typeAnnotation)) {
          pageBindings.add(candidate.name);
        }
      }
    }

    function recordTestFixturePages(node) {
      if (
        node.type !== 'CallExpression' ||
        !node.arguments.some(
          (argument) => argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression',
        )
      ) {
        return;
      }
      const callback = node.arguments.find(
        (argument) => argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression',
      );
      const fixture = callback?.params[0];
      if (fixture?.type !== 'ObjectPattern') return;
      for (const property of fixture.properties) {
        if (property.type !== 'Property' || property.value.type !== 'Identifier') continue;
        const fixtureName = property.key.type === 'Identifier' ? property.key.name : property.key.value;
        if (typeof fixtureName === 'string' && /page$/i.test(fixtureName)) {
          pageBindings.add(property.value.name);
        }
      }
    }

    function unwrapExpression(node) {
      if (!node) return node;
      if (node.type === 'AwaitExpression' || node.type === 'ChainExpression') {
        return unwrapExpression(node.argument ?? node.expression);
      }
      return node;
    }

    function expressionReturnsPage(node) {
      const expression = unwrapExpression(node);
      if (expression?.type === 'Identifier') return pageBindings.has(expression.name);
      if (expression?.type !== 'CallExpression') return false;
      const callee = expression.callee;
      if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') {
        return false;
      }
      if (callee.property.name === 'newPage') return true;
      if (callee.property.name !== 'waitForEvent') return false;
      const eventName = expression.arguments[0];
      return eventName?.type === 'Literal' && /^(page|popup)$/.test(eventName.value);
    }

    function recordAssignment(left, right) {
      if (left.type === 'Identifier' && expressionReturnsPage(right)) {
        pageBindings.add(left.name);
      }
    }

    return {
      ImportDeclaration: recordPlaywrightPageImports,
      ArrowFunctionExpression: recordFunctionPageParameters,
      FunctionDeclaration: recordFunctionPageParameters,
      FunctionExpression: recordFunctionPageParameters,
      CallExpression(node) {
        recordTestFixturePages(node);
        if (node.callee.type !== 'MemberExpression') return;
        if (node.callee.object.type !== 'Identifier') return;
        if (node.callee.property.type !== 'Identifier') return;
        if (!pageBindings.has(node.callee.object.name)) return;
        if (node.callee.property.name === 'getByText') {
          context.report({ node, messageId: 'getByText' });
        }
        if (node.callee.property.name === 'locator') {
          context.report({ node, messageId: 'locator' });
        }
      },
      VariableDeclarator(node) {
        if (node.init) recordAssignment(node.id, node.init);
      },
      AssignmentExpression(node) {
        recordAssignment(node.left, node.right);
      },
    };
  },
};

export const noVisibleTextZeroCountRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      hiddenAbsence:
        'visibleText() filters hidden DOM matches, so toHaveCount(0) cannot prove data absence. Use textInDom() for privacy and authorization absence assertions.',
    },
  },
  create(context) {
    const visibleTextBindings = new Set(['visibleText']);

    return {
      ImportSpecifier(node) {
        if (node.imported.type === 'Identifier' && node.imported.name === 'visibleText') {
          visibleTextBindings.add(node.local.name);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'toHaveCount' ||
          node.arguments[0]?.type !== 'Literal' ||
          node.arguments[0].value !== 0
        ) {
          return;
        }
        const expectCall = node.callee.object;
        if (
          expectCall.type !== 'CallExpression' ||
          expectCall.callee.type !== 'Identifier' ||
          expectCall.callee.name !== 'expect'
        ) {
          return;
        }
        const locatorCall = expectCall.arguments[0];
        if (
          locatorCall?.type === 'CallExpression' &&
          locatorCall.callee.type === 'Identifier' &&
          visibleTextBindings.has(locatorCall.callee.name)
        ) {
          context.report({ node, messageId: 'hiddenAbsence' });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Locator ownership (docs/technical/testing.md, "Write a spec that stands
// alone"). A spec names what it acts on; the area locator layer under
// tests/golden/support/steps/ (audit parts in tests/audit/support/) owns how a
// control is written, so a deliberate rename is one edit in one file.

/** Copy is static text with three or more letters; shorter text is data such as a separator or a unit. */
const MINIMUM_COPY_LETTERS = 3;
const LETTER = /\p{L}/gu;

function letterCount(text) {
  return (text.match(LETTER) ?? []).length;
}

function staticTextOf(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'Literal' && node.regex) {
    // Escapes such as \d or \s are pattern syntax, not letters of copy.
    return node.regex.pattern.replace(/\\./g, ' ');
  }
  if (node.type === 'TemplateLiteral') {
    // Each static part counts on its own: `${jobNumber}-A` is data, `${name} bearbeiten` is copy.
    const parts = node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
    return parts.reduce((longest, part) => (letterCount(part) > letterCount(longest) ? part : longest), '');
  }
  return null;
}

/** Resolves an identifier to the initializer of a `const` declared in the same file. */
function constantInitializer(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      const definition = variable.defs[0];
      if (
        definition?.type === 'Variable' &&
        definition.parent?.kind === 'const' &&
        definition.node.id.type === 'Identifier'
      )
        return definition.node.init ?? null;
      return null;
    }
    scope = scope.upper;
  }
  return null;
}

function propertyNamed(objectExpression, name) {
  if (objectExpression?.type !== 'ObjectExpression') return null;
  return (
    objectExpression.properties.find(
      (property) =>
        property.type === 'Property' &&
        !property.computed &&
        ((property.key.type === 'Identifier' && property.key.name === name) ||
          (property.key.type === 'Literal' && property.key.value === name)),
    ) ?? null
  );
}

/** Returns the node that carries copy inside an expression, or null. */
function copyNode(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  seen.add(node);
  const text = staticTextOf(node);
  if (text !== null) return letterCount(text) >= MINIMUM_COPY_LETTERS ? node : null;
  switch (node.type) {
    case 'ConditionalExpression':
      return copyNode(context, node.consequent, seen) ?? copyNode(context, node.alternate, seen);
    case 'LogicalExpression':
    case 'BinaryExpression':
      return copyNode(context, node.left, seen) ?? copyNode(context, node.right, seen);
    case 'ArrayExpression':
      for (const element of node.elements) {
        const found = copyNode(context, element, seen);
        if (found) return found;
      }
      return null;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return copyNode(context, node.expression, seen);
    case 'Identifier': {
      // A spec-local constant (`const save = 'Speichern'`) is copy in disguise.
      const initializer = constantInitializer(context, node);
      // A constant built from a template with a value (`A1 Kunde ${runId}`) is a
      // run-scoped record name: data the spec owns, not copy.
      if (initializer?.type === 'TemplateLiteral' && initializer.expressions.length > 0) return null;
      return initializer && copyNode(context, initializer, seen) ? node : null;
    }
    case 'MemberExpression': {
      // So is a spec-local constant map (`const LABELS = { save: 'Speichern' }`).
      if (node.object.type !== 'Identifier' || node.computed || node.property.type !== 'Identifier')
        return null;
      const property = propertyNamed(constantInitializer(context, node.object), node.property.name);
      return property && copyNode(context, property.value, seen) ? node : null;
    }
    default:
      return null;
  }
}

const TEXT_LOCATOR_METHODS = new Set([
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTitle',
  'getByAltText',
]);
const TEXT_ASSERTIONS = new Set(['toHaveText', 'toContainText']);
/** Shared support helpers whose text parameter is copy, by argument index. */
const TEXT_HELPER_ARGUMENTS = new Map([
  ['visibleText', 1],
  ['visibleMatchingText', 1],
  ['textInDom', 1],
  ['exactText', 1],
  ['visibleExactText', 1],
  ['expectBannerAfter', 1],
  ['expectVisibleAfterSave', 1],
  ['inputByValue', 1],
  ['typeIntoDatePicker', 1],
]);

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier')
    return callee.property.name;
  return null;
}

export const noCopyInSpecLocatorRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      locator:
        'Copy in a spec locator ({{method}}) couples the spec to wording that slices change on purpose. Locate the control through its area module under tests/golden/support/steps/ (a product label owner such as workTransitionActionLabel, or one area constant) and pass only data from the spec.',
      assertion:
        'Literal copy in {{method}} pins wording in the spec. Take the expected text from the product message map or the area module, so a deliberate rewording is one edit.',
      helper:
        'Copy passed to the support helper {{method}} is a locator in disguise. Let the area module own the text and pass only data from the spec.',
    },
  },
  create(context) {
    function report(node, messageId, method) {
      context.report({ node, messageId, data: { method } });
    }
    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!name) return;
        const member = node.callee.type === 'MemberExpression';
        if (member && name === 'getByRole') {
          const option = propertyNamed(node.arguments[1], 'name');
          const found = option && copyNode(context, option.value);
          if (found) report(found, 'locator', 'getByRole name');
          return;
        }
        if (member && TEXT_LOCATOR_METHODS.has(name)) {
          const found = copyNode(context, node.arguments[0]);
          if (found) report(found, 'locator', name);
          return;
        }
        if (member && TEXT_ASSERTIONS.has(name)) {
          const found = copyNode(context, node.arguments[0]);
          if (found) report(found, 'assertion', name);
          return;
        }
        if (!member && TEXT_HELPER_ARGUMENTS.has(name)) {
          const found = copyNode(context, node.arguments[TEXT_HELPER_ARGUMENTS.get(name)]);
          if (found) report(found, 'helper', name);
        }
      },
      Property(node) {
        if (node.computed || node.key.type !== 'Identifier') return;
        if (node.key.name !== 'hasText' && node.key.name !== 'hasNotText') return;
        const found = copyNode(context, node.value);
        if (found) report(found, 'locator', node.key.name);
      },
    };
  },
};

const LOCATOR_METHODS = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTitle',
  'getByAltText',
  'getByTestId',
  'filter',
  'first',
  'last',
  'nth',
  'and',
  'or',
]);

function returnsLocatorExpression(expression) {
  let current = expression;
  while (current?.type === 'AwaitExpression' || current?.type === 'TSAsExpression')
    current = current.type === 'AwaitExpression' ? current.argument : current.expression;
  return (
    current?.type === 'CallExpression' &&
    current.callee.type === 'MemberExpression' &&
    current.callee.property.type === 'Identifier' &&
    LOCATOR_METHODS.has(current.callee.property.name)
  );
}

function isLocatorType(node) {
  return (
    node?.type === 'TSTypeReference' &&
    node.typeName.type === 'Identifier' &&
    node.typeName.name === 'Locator'
  );
}

function annotatedAsLocator(functionNode) {
  const annotation = functionNode.returnType?.typeAnnotation;
  if (isLocatorType(annotation)) return true;
  // Promise<Locator>
  return (
    annotation?.type === 'TSTypeReference' &&
    annotation.typeName.type === 'Identifier' &&
    annotation.typeName.name === 'Promise' &&
    isLocatorType((annotation.typeArguments ?? annotation.typeParameters)?.params?.[0])
  );
}

export const noLocatorFunctionInSpecRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      helper:
        'A function in a spec file that returns a Locator is a second owner of a control. Move it into the area module under tests/golden/support/steps/ (audit-only parts: tests/audit/support/) and import it.',
    },
  },
  create(context) {
    function check(node) {
      if (annotatedAsLocator(node)) {
        context.report({ node, messageId: 'helper' });
        return;
      }
      if (node.body.type !== 'BlockStatement') {
        if (returnsLocatorExpression(node.body)) context.report({ node, messageId: 'helper' });
        return;
      }
      if (
        node.body.body.some(
          (statement) => statement.type === 'ReturnStatement' && returnsLocatorExpression(statement.argument),
        )
      )
        context.report({ node, messageId: 'helper' });
    }
    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
    };
  },
};

const CLASS_SELECTOR = /\[class[*^$~|]?=|contains\(\s*@class/;
const STRUCTURAL_SELECTOR = /^\s*xpath=|^\s*\.\.\s*$|ancestor::/;

export const noStructuralLocatorRule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { classesOnly: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      structural:
        'A structural locator (xpath, a parent step or an ancestor) breaks when markup moves. Use getByRole("main" | "region" | "form" | "row", { name }), a row by data-row-id, or getByTestId on the container.',
      classes:
        'A CSS class is a design token, not a hook: a pure design change breaks this locator. Use a role and name, data-row-id or getByTestId.',
    },
  },
  create(context) {
    const classesOnly = context.options[0]?.classesOnly === true;
    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression' || calleeName(node.callee) !== 'locator') return;
        const text = staticTextOf(node.arguments[0]);
        if (text === null) return;
        if (CLASS_SELECTOR.test(text)) context.report({ node, messageId: 'classes' });
        else if (!classesOnly && STRUCTURAL_SELECTOR.test(text))
          context.report({ node, messageId: 'structural' });
      },
    };
  },
};

export const noRawKeyPressRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      press:
        'A raw key press races the app: it lands while a save runs or while focus sits in a combobox. Use pressKey or dismissDialog from tests/golden/support/steps/interaction.ts.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression' && calleeName(node.callee) === 'press')
          context.report({ node, messageId: 'press' });
      },
    };
  },
};

const TRANSPORT_METHODS = new Set(['postData', 'postDataJSON', 'postDataBuffer', 'finished']);

export const noTransportInternalsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      transport:
        'Server Action payloads and Flight stream completion are transport internals that change without a product change. Wait for the exact changed fact on screen or in the database instead.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression' && TRANSPORT_METHODS.has(calleeName(node.callee)))
          context.report({ node, messageId: 'transport' });
      },
    };
  },
};

/**
 * Playwright queries a `has` or `hasNot` locator inside each element the outer
 * locator matched. A chain that starts at a scope (`dialog.getByRole(...)`)
 * therefore looks for the scope inside the match and never finds it; two
 * migrated helpers failed this way. The chain must start at the page.
 */
export const noScopedHasLocatorRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      scoped:
        'A has/hasNot locator is queried inside each match, so a chain from a scope ({{root}}) never matches. Start the inner locator at the page (page.getBy..., scope.page().getBy...).',
    },
  },
  create(context) {
    function chainRoot(node) {
      let current = node;
      while (current) {
        if (current.type === 'CallExpression') {
          const callee = current.callee;
          if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
            if (callee.property.name === 'page') return { pageLike: true };
            current = callee.object;
            continue;
          }
          // A helper call such as dialogTitle(page) owns its own chain.
          return { pageLike: true };
        }
        if (current.type === 'MemberExpression') {
          current = current.object;
          continue;
        }
        if (current.type === 'Identifier')
          return { pageLike: /page$/i.test(current.name), name: current.name };
        return { pageLike: true };
      }
      return { pageLike: true };
    }
    return {
      Property(node) {
        if (node.computed || node.key.type !== 'Identifier') return;
        if (node.key.name !== 'has' && node.key.name !== 'hasNot') return;
        if (node.value.type !== 'CallExpression') return;
        const root = chainRoot(node.value);
        if (!root.pageLike)
          context.report({ node: node.value, messageId: 'scoped', data: { root: root.name } });
      },
    };
  },
};

/**
 * Support modules that are measurement-digest inputs (lib/testing/performance-context.ts).
 * Their bytes are part of every reviewed performance reference, so no rule may
 * force an edit; playwright-spec-rules.test.mjs keeps the list complete.
 */
export const MEASUREMENT_DIGEST_SUPPORT_FILES = [
  'tests/golden/support/seed.ts',
  'tests/golden/support/scenario-measurement.ts',
  'tests/golden/support/browser-observation.ts',
  'tests/golden/support/sessions.ts',
  'tests/audit/support/performance-steps.ts',
  'tests/audit/support/performance-profile.ts',
  'tests/audit/support/seed-publication.ts',
];

export const playwrightSpecRules = {
  rules: {
    'no-unscoped-page-selectors': noUnscopedPageSelectorsRule,
    'no-visible-text-zero-count': noVisibleTextZeroCountRule,
    'no-copy-in-spec-locator': noCopyInSpecLocatorRule,
    'no-locator-function-in-spec': noLocatorFunctionInSpecRule,
    'no-structural-locator': noStructuralLocatorRule,
    'no-raw-key-press': noRawKeyPressRule,
    'no-transport-internals': noTransportInternalsRule,
    'no-scoped-has-locator': noScopedHasLocatorRule,
  },
};
