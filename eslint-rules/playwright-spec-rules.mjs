export const noUnscopedPageSelectorsRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      getByText:
        "Unscoped Page.getByText hits duplicate responsive renders. Use visibleText()/textInDom() or scope the lookup to its owning region first.",
      locator:
        "Raw page-level selectors couple specs to markup. Use a role/label locator, scope from a semantic container, or move the lookup into a named support helper.",
    },
  },
  create(context) {
    const pageBindings = new Set();
    const pageTypeBindings = new Set(["Page"]);
    const playwrightNamespaceBindings = new Set();

    function recordPlaywrightPageImports(node) {
      if (node.source.value !== "@playwright/test") return;
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          playwrightNamespaceBindings.add(specifier.local.name);
          continue;
        }
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.imported.type === "Identifier" &&
          specifier.imported.name === "Page"
        ) {
          pageTypeBindings.add(specifier.local.name);
        }
      }
    }

    function isPageTypeAnnotation(annotation) {
      const typeNode = annotation?.type === "TSTypeAnnotation" ? annotation.typeAnnotation : annotation;
      if (typeNode?.type !== "TSTypeReference") return false;
      if (typeNode.typeName.type === "Identifier") {
        return pageTypeBindings.has(typeNode.typeName.name);
      }
      return (
        typeNode.typeName.type === "TSQualifiedName" &&
        typeNode.typeName.left.type === "Identifier" &&
        playwrightNamespaceBindings.has(typeNode.typeName.left.name) &&
        typeNode.typeName.right.type === "Identifier" &&
        typeNode.typeName.right.name === "Page"
      );
    }

    function recordFunctionPageParameters(node) {
      for (const parameter of node.params) {
        const candidate = parameter.type === "AssignmentPattern" ? parameter.left : parameter;
        if (candidate.type === "Identifier" && isPageTypeAnnotation(candidate.typeAnnotation)) {
          pageBindings.add(candidate.name);
        }
      }
    }

    function recordTestFixturePages(node) {
      if (
        node.type !== "CallExpression" ||
        !node.arguments.some(
          (argument) =>
            argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression"
        )
      ) {
        return;
      }
      const callback = node.arguments.find(
        (argument) =>
          argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression"
      );
      const fixture = callback?.params[0];
      if (fixture?.type !== "ObjectPattern") return;
      for (const property of fixture.properties) {
        if (property.type !== "Property" || property.value.type !== "Identifier") continue;
        const fixtureName =
          property.key.type === "Identifier" ? property.key.name : property.key.value;
        if (typeof fixtureName === "string" && /page$/i.test(fixtureName)) {
          pageBindings.add(property.value.name);
        }
      }
    }

    function unwrapExpression(node) {
      if (!node) return node;
      if (node.type === "AwaitExpression" || node.type === "ChainExpression") {
        return unwrapExpression(node.argument ?? node.expression);
      }
      return node;
    }

    function expressionReturnsPage(node) {
      const expression = unwrapExpression(node);
      if (expression?.type === "Identifier") return pageBindings.has(expression.name);
      if (expression?.type !== "CallExpression") return false;
      const callee = expression.callee;
      if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") {
        return false;
      }
      if (callee.property.name === "newPage") return true;
      if (callee.property.name !== "waitForEvent") return false;
      const eventName = expression.arguments[0];
      return eventName?.type === "Literal" && /^(page|popup)$/.test(eventName.value);
    }

    function recordAssignment(left, right) {
      if (left.type === "Identifier" && expressionReturnsPage(right)) {
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
        if (node.callee.type !== "MemberExpression") return;
        if (node.callee.object.type !== "Identifier") return;
        if (node.callee.property.type !== "Identifier") return;
        if (!pageBindings.has(node.callee.object.name)) return;
        if (node.callee.property.name === "getByText") {
          context.report({ node, messageId: "getByText" });
        }
        if (node.callee.property.name === "locator") {
          context.report({ node, messageId: "locator" });
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
    type: "problem",
    schema: [],
    messages: {
      hiddenAbsence:
        "visibleText() filters hidden DOM matches, so toHaveCount(0) cannot prove data absence. Use textInDom() for privacy and authorization absence assertions.",
    },
  },
  create(context) {
    const visibleTextBindings = new Set(["visibleText"]);

    return {
      ImportSpecifier(node) {
        if (
          node.imported.type === "Identifier" &&
          node.imported.name === "visibleText"
        ) {
          visibleTextBindings.add(node.local.name);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "toHaveCount" ||
          node.arguments[0]?.type !== "Literal" ||
          node.arguments[0].value !== 0
        ) {
          return;
        }
        const expectCall = node.callee.object;
        if (
          expectCall.type !== "CallExpression" ||
          expectCall.callee.type !== "Identifier" ||
          expectCall.callee.name !== "expect"
        ) {
          return;
        }
        const locatorCall = expectCall.arguments[0];
        if (
          locatorCall?.type === "CallExpression" &&
          locatorCall.callee.type === "Identifier" &&
          visibleTextBindings.has(locatorCall.callee.name)
        ) {
          context.report({ node, messageId: "hiddenAbsence" });
        }
      },
    };
  },
};

export const playwrightSpecRules = {
  rules: {
    "no-unscoped-page-selectors": noUnscopedPageSelectorsRule,
    "no-visible-text-zero-count": noVisibleTextZeroCountRule,
  },
};
