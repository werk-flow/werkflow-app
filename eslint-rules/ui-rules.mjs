// Product-UI lint rules (design canon, werkflow-design skill). Each rule
// names the incident or canon rule that motivated it so the why travels with
// the no (decision 0005).

const SPACED_CONTAINER_CLASS = /(?:^|\s)(?:gap-|space-y-|space-x-|items-center|flex-row|sr-only)/;

function jsxElementName(node) {
  if (!node || node.type !== "JSXElement") return null;
  const name = node.openingElement.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression" && name.property.type === "JSXIdentifier") {
    return name.property.name;
  }
  return null;
}

function classNameLiteral(node) {
  const attribute = node.openingElement.attributes.find(
    (candidate) =>
      candidate.type === "JSXAttribute" &&
      candidate.name.type === "JSXIdentifier" &&
      candidate.name.name === "className",
  );
  if (!attribute || !attribute.value) return null;
  if (attribute.value.type === "Literal") return String(attribute.value.value);
  if (attribute.value.type === "JSXExpressionContainer") {
    const expression = attribute.value.expression;
    if (expression.type === "Literal") return String(expression.value);
    if (expression.type === "TemplateLiteral") {
      return expression.quasis.map((quasi) => quasi.value.raw).join(" ");
    }
    // cn(...) and friends: collect every string literal argument.
    if (expression.type === "CallExpression") {
      return expression.arguments
        .flatMap((argument) => collectStringLiterals(argument))
        .join(" ");
    }
  }
  return null;
}

function collectStringLiterals(node) {
  if (!node) return [];
  if (node.type === "Literal" && typeof node.value === "string") return [node.value];
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.raw);
  if (node.type === "LogicalExpression") {
    return [...collectStringLiterals(node.left), ...collectStringLiterals(node.right)];
  }
  if (node.type === "ConditionalExpression") {
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
export const labelInSpacedContainerRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      useField: "Label-plus-control stacks use Field so naming, required state and errors stay connected (werkflow-design: every field is a Field).",
      bareContainer:
        "<Label> sits in a container with no spacing, so it touches its control. Use <Field label=...> from components/ui/field (design canon: every field is a Field), or give the container gap-2 / space-y-2.",
    },
  },
  create(context) {
    const controlNames = new Set(["Input", "Textarea", "Select", "SearchableSelect", "SearchableMultiSelect", "DatePicker", "TimeInput", "DurationHoursInput", "QuantityStepper", "DateTimeField", "input", "textarea", "select"]);
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
        if (jsxElementName(node) !== "Label") return;
        for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
          if (jsxElementName(ancestor) === 'Field') return;
        }
        let parent = node.parent;
        while (parent && (parent.type === "JSXFragment" || parent.type === "JSXExpressionContainer")) {
          parent = parent.parent;
        }
        if (!parent || parent.type !== "JSXElement") return;
        const parentName = jsxElementName(parent);
        if (parentName === "Field") return;
        if (parent.children.some((child) => child !== node && containsUnownedControl(child))) {
          context.report({ node: node.openingElement, messageId: "useField" });
          return;
        }
        const classes = classNameLiteral(parent);
        if (classes !== null && SPACED_CONTAINER_CLASS.test(classes)) return;
        // A Label that wraps its control (checkbox rows) is fine: the label is
        // the container. Only report when the Label is a sibling of a control.
        const siblings = parent.children.filter(
          (child) => child.type === "JSXElement" || child.type === "JSXExpressionContainer",
        );
        if (siblings.length < 2) return;
        context.report({ node: node.openingElement, messageId: "bareContainer" });
      },
    };
  },
};

export const uiRules = {
  rules: {
    "label-in-spaced-container": labelInSpacedContainerRule,
  },
};

export default uiRules;
