import { relative } from 'node:path';

// Test hygiene (docs/technical/testing.md, Never). A test waits on the fact it
// needs, never on the clock; it runs once, under the shared timeout, at a
// pinned instant; and a skipped test names the issue that brings it back.

/**
 * The comment on the line above a skipped test:
 * `// quarantine: werk-flow/werkflow-planning#<n> <why>`. scripts/list-quarantines.ts
 * prints every one in the nightly run.
 */
export const QUARANTINE_COMMENT = /^\s*quarantine:\s*werk-flow\/werkflow-planning#(\d+)\s+(\S.*)$/;
const QUARANTINE_MARK = /^\s*quarantine:/;

/**
 * Where no test may be quarantined: the security and permission tests, the SQL
 * tests and the Server Action boundary fixtures. A test file that runs a
 * boundary fixture names its path, so the rule reads that too.
 */
const QUARANTINE_REFUSED_PATHS = [
  'tests/audit/security/',
  'supabase/tests/',
  'lib/security/',
  'lib/testing/fixtures/',
];
const BOUNDARY_FIXTURE_REFERENCE = 'testing/fixtures/';

const TEST_ROOTS = new Set(['test', 'it', 'describe']);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
const LOOP_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);
/** The modifiers between `test`, `it` or `describe` and a registration call. */
const REGISTRATION_SEGMENTS = new Set([
  'describe',
  'only',
  'skip',
  'fixme',
  'todo',
  'serial',
  'parallel',
  'concurrent',
  'failing',
  'each',
  'if',
  'skipIf',
  'todoIf',
]);
const EXCLUDED_SEGMENTS = new Set(['skip', 'fixme', 'todo']);
const SLEEP_NAME = /^(?:sleep|delay|pause)(?:Ms|For|Sync)?$|^waitForTimeout$/i;
/** A repeat flag as an argument or inside a shell command line. */
const RUNNER_REPEAT_FLAG = /(?:^|\s)--(?:rerun-each|retries|retry|repeat-each)(?:=|\s|$)/;

/**
 * The names along a callee: `test.describe.skip` is `['test', 'describe', 'skip']`,
 * `test.each(table)` is `['test', 'each()']`. Null for anything that is not a
 * chain of names and calls.
 */
function calleePath(node) {
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'CallExpression') {
    const path = calleePath(node.callee);
    return path && [...path.slice(0, -1), `${path.at(-1)}()`];
  }
  if (node.type !== 'MemberExpression') return null;
  const object = calleePath(node.object);
  if (!object) return null;
  if (!node.computed && node.property.type === 'Identifier') return [...object, node.property.name];
  if (node.property.type === 'Literal' && typeof node.property.value === 'string')
    return [...object, node.property.value];
  return null;
}

/** A call that registers a test or a group: `test(...)`, `test.describe.skip(...)`, `test.each(table)(...)`. */
function isRegistration(path) {
  if (!path || !TEST_ROOTS.has(path[0])) return false;
  const modifiers = path.slice(1);
  const last = modifiers.at(-1);
  // `test.each(table)` and `test.skipIf(condition)` build the registration; their result registers.
  if (last && ['each', 'if', 'skipIf', 'todoIf'].includes(last)) return false;
  return modifiers.every((segment) => REGISTRATION_SEGMENTS.has(segment.replace(/\(\)$/, '')));
}

function keyName(property) {
  if (property.type !== 'Property' || property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  return typeof property.key.value === 'string' ? property.key.value : null;
}

function optionNamed(argument, names) {
  if (argument?.type !== 'ObjectExpression') return null;
  return argument.properties.find((property) => names.includes(keyName(property))) ?? null;
}

/** The arguments after a test's body: the first function argument, or the second argument when the body is passed by name. */
function argumentsAfterBody(call) {
  const bodyIndex = call.arguments.findIndex((argument) => FUNCTION_TYPES.has(argument.type));
  if (bodyIndex >= 0) return call.arguments.slice(bodyIndex + 1);
  const [, second, ...rest] = call.arguments;
  return second && second.type !== 'ObjectExpression' ? rest : [];
}

/** Walks a subtree without entering nested functions, nor the nodes `stop` names. */
function visitEager(root, visit, stop = () => false) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== 'string') continue;
    if (node !== root && stop(node)) continue;
    visit(node);
    if (node !== root && FUNCTION_TYPES.has(node.type)) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value.type === 'string') stack.push(value);
    }
  }
}

function isClockRead(node) {
  if (node.type === 'NewExpression')
    return node.callee.type === 'Identifier' && node.callee.name === 'Date' && !node.arguments.length;
  if (node.type !== 'CallExpression') return false;
  const path = calleePath(node.callee);
  if (!path) return false;
  const name = path.join('.');
  return name === 'Date.now' || name === 'performance.now' || name === 'Date';
}

function isGlobalTimer(path, name) {
  return path?.at(-1) === name && (path.length === 1 || (path.length === 2 && GLOBAL_OBJECTS.has(path[0])));
}

function callsName(root, name) {
  let found = false;
  visitEager(root, (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === name)
      found = true;
  });
  return found;
}

/**
 * `setTimeout` called from the executor of `new Promise(...)` to settle it: a
 * wall-clock wait. A timer that only rejects bounds a wait and passes.
 */
function isTimerPromise(call, path) {
  if (!isGlobalTimer(path, 'setTimeout')) return false;
  let scope = call.parent;
  while (scope && !FUNCTION_TYPES.has(scope.type)) scope = scope.parent;
  const promise = scope?.parent;
  if (
    promise?.type !== 'NewExpression' ||
    promise.callee.type !== 'Identifier' ||
    promise.callee.name !== 'Promise' ||
    promise.arguments[0] !== scope
  )
    return false;
  const [resolveParam, rejectParam] = scope.params.map((param) =>
    param.type === 'Identifier' ? param.name : null,
  );
  const [callback] = call.arguments;
  if (callback?.type === 'Identifier') return !rejectParam || callback.name !== rejectParam;
  if (callback && FUNCTION_TYPES.has(callback.type) && rejectParam && callsName(callback, rejectParam))
    return resolveParam !== null && callsName(callback, resolveParam);
  return true;
}

function isWait(node) {
  if (node.type !== 'CallExpression') return false;
  const path = calleePath(node.callee);
  if (!path) return false;
  if (isTimerPromise(node, path)) return true;
  return SLEEP_NAME.test(path.at(-1).replace(/\(\)$/, ''));
}

function relativePath(context) {
  return relative(context.cwd ?? process.cwd(), context.filename).replaceAll('\\', '/');
}

/** Modules whose named imports sleep; a namespace or default import of the timer modules counts too. */
const SLEEP_IMPORTS = new Map([
  ['node:timers/promises', { names: ['setTimeout', 'scheduler'], whole: true }],
  ['timers/promises', { names: ['setTimeout', 'scheduler'], whole: true }],
  ['bun', { names: ['sleep', 'sleepSync'], whole: false }],
]);

const waitMessage =
  'A test waits on the fact it needs, never on the clock: a fixed delay hides a race and stretches the run. Await the promise, event or state that proves the step finished (a web-first assertion or expect.poll in the browser; setImmediate to flush callbacks in a unit test).';

/** `new Promise(r => setTimeout(r, n))`, `Bun.sleep`, `page.waitForTimeout` and `timers/promises`. */
const noWallClockWaitRule = {
  meta: { type: 'problem', schema: [], messages: { wait: waitMessage } },
  create(context) {
    return {
      CallExpression(node) {
        const path = calleePath(node.callee);
        if (!path) return;
        const name = path.join('.');
        if (
          name === 'Bun.sleep' ||
          name === 'Bun.sleepSync' ||
          path.at(-1) === 'waitForTimeout' ||
          isTimerPromise(node, path)
        )
          context.report({ node, messageId: 'wait' });
      },
      ImportDeclaration(node) {
        const sleeps = SLEEP_IMPORTS.get(node.source.value);
        if (!sleeps) return;
        for (const specifier of node.specifiers) {
          const imported = specifier.type === 'ImportSpecifier' ? specifier.imported.name : null;
          if (imported === null ? sleeps.whole : sleeps.names.includes(imported))
            context.report({ node: specifier, messageId: 'wait' });
        }
      },
    };
  },
};

/**
 * A loop that awaits and either sleeps or checks a clock deadline polls by
 * hand. expect.poll and settledBeforeTimeout (lib/testing/spec-support/) own
 * polling and report what they waited for.
 */
const noPollingLoopRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      loop: 'A loop that awaits and then sleeps or checks a clock deadline polls by hand. Wait with expect.poll or a web-first assertion; a wait that may time out branches through settledBeforeTimeout.',
    },
  },
  create(context) {
    function inspect(loop) {
      let awaits = false;
      let waits = false;
      // `const elapsed = Date.now() - start` inside the loop carries the clock into a later condition.
      const clockNames = new Set();
      const readsClock = (root) => {
        let found = false;
        visitEager(root, (inner) => {
          if (isClockRead(inner) || (inner.type === 'Identifier' && clockNames.has(inner.name))) found = true;
        });
        return found;
      };
      const assignments = [];
      visitEager(loop, (node) => {
        if (node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await)) awaits = true;
        const [target, value] =
          node.type === 'VariableDeclarator'
            ? [node.id, node.init]
            : node.type === 'AssignmentExpression'
              ? [node.left, node.right]
              : [];
        if (target?.type === 'Identifier' && value) assignments.push([target.name, value]);
      });
      // To a fixed point: `const now = Date.now(); const elapsed = now - start` reads the clock twice removed.
      for (let grown = true; grown; ) {
        grown = false;
        for (const [name, value] of assignments) {
          if (clockNames.has(name) || !readsClock(value)) continue;
          clockNames.add(name);
          grown = true;
        }
      }
      // A nested loop answers for its own waits, so an outer loop over items is not a poll.
      visitEager(
        loop,
        (node) => {
          if (isWait(node)) waits = true;
          const condition =
            node === loop || node.type === 'IfStatement' || node.type === 'ConditionalExpression'
              ? node.test
              : null;
          if (condition && readsClock(condition)) waits = true;
        },
        (node) => LOOP_TYPES.has(node.type),
      );
      if (awaits && waits) context.report({ node: loop, messageId: 'loop' });
    }
    return Object.fromEntries([...LOOP_TYPES].map((type) => [type, inspect]));
  },
};

/** `test(name, body, 5_000)`, `{ timeout }`, `test.slow()`, `test.setTimeout`, `setDefaultTimeout`, `describe.configure({ timeout })`. */
const noPerTestTimeoutRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      timeout:
        'A test runs under the shared timeout of its runner (scripts/unit-test-timeout.ts, the Playwright configs). Make a slow test cheaper; a longer timeout hides the regression it measures.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const path = calleePath(node.callee);
        if (!path) return;
        const last = path.at(-1);
        const report = (target) => context.report({ node: target, messageId: 'timeout' });
        if (isRegistration(path)) {
          const option = node.arguments.map((argument) => optionNamed(argument, ['timeout'])).find(Boolean);
          if (option) return report(option);
          const [extra] = argumentsAfterBody(node);
          if (extra) report(extra);
          return;
        }
        if (path.length === 1 && last === 'setDefaultTimeout') return report(node);
        const owner = path.slice(0, -1);
        const ownedByTest =
          TEST_ROOTS.has(owner[0]) ||
          owner.includes('info()') ||
          /^(?:testInfo|jest|vi)$/.test(owner[0] ?? '');
        if (ownedByTest && (last === 'setTimeout' || last === 'slow')) return report(node);
        if (ownedByTest && last === 'configure') {
          const option = optionNamed(node.arguments[0], ['timeout']);
          if (option) report(option);
        }
      },
    };
  },
};

/** `retries` other than 0, a test's `retry` or `repeats` option, and the runners' repeat flags. */
const noRetriesRule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { flags: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      retries:
        'A test runs once: a retry turns a flaky failure into a pass and hides it. Find the cause (testing.md, Failures) instead.',
    },
  },
  create(context) {
    const flags = context.options[0]?.flags === true;
    const report = (node) => context.report({ node, messageId: 'retries' });
    const checkFlag = (node, text) => {
      if (flags && typeof text === 'string' && RUNNER_REPEAT_FLAG.test(text)) report(node);
    };
    return {
      Property(node) {
        if (keyName(node) !== 'retries') return;
        if (node.value.type === 'Literal' && node.value.value === 0) return;
        report(node);
      },
      CallExpression(node) {
        if (!isRegistration(calleePath(node.callee))) return;
        for (const argument of node.arguments) {
          const option = optionNamed(argument, ['retry', 'repeats']);
          if (option) report(option);
        }
      },
      Literal(node) {
        checkFlag(node, node.value);
      },
      TemplateElement(node) {
        checkFlag(node, node.value.cooked);
      },
    };
  },
};

/** `Date.now()`, `new Date()`, `Date()` and `performance.now()` in a unit test. */
const noUnpinnedClockRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      clock:
        "A unit test reads no wall clock: it passes or fails by the day and the machine it runs on. Use a fixed instant (`new Date('2026-03-02T08:00:00Z')`), setSystemTime from bun:test, or the module's injected clock.",
    },
  },
  create(context) {
    const check = (node) => {
      if (isClockRead(node)) context.report({ node, messageId: 'clock' });
    };
    return { CallExpression: check, NewExpression: check };
  },
};

/** A clock read for a duration: the wall clock and the monotonic timers. */
function isDurationClockRead(node) {
  if (isClockRead(node)) return true;
  if (node.type !== 'CallExpression') return false;
  const name = calleePath(node.callee)?.join('.');
  return name === 'process.hrtime' || name === 'process.hrtime.bigint' || name === 'Bun.nanoseconds';
}

/** An instant read from a date: `Date.parse(text)`, `new Date(value)`, `date.getTime()`. */
function isInstant(node) {
  if (node.type === 'NewExpression') return node.callee.type === 'Identifier' && node.callee.name === 'Date';
  if (node.type !== 'CallExpression') return false;
  const path = calleePath(node.callee);
  return path?.join('.') === 'Date.parse' || (path?.length !== 1 && path?.at(-1) === 'getTime');
}

/**
 * What a call puts under the test's control: `page` for Playwright's `page.clock`, whose clock the
 * page's scripts read, `process` for bun:test's `setSystemTime` and fake timers, which pin the test
 * process's `Date`. Null for any other call.
 */
function controlledClock(node) {
  if (node.type !== 'CallExpression') return null;
  const path = calleePath(node.callee);
  const name = path?.at(-1);
  if (path?.at(-2) === 'clock' && ['install', 'setFixedTime', 'setSystemTime'].includes(name)) return 'page';
  return name === 'setSystemTime' || name === 'useFakeTimers' ? 'process' : null;
}

/** The calls whose function argument runs in the browser page, on the page's clock. */
const BROWSER_CALLS = new Set([
  'evaluate',
  'evaluateHandle',
  'waitForFunction',
  'addInitScript',
  '$eval',
  '$$eval',
]);

/** Whether a node runs inside a function the test hands to the browser page. */
function inBrowserCallback(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    const call = ancestor.parent;
    if (
      FUNCTION_TYPES.has(ancestor.type) &&
      call?.type === 'CallExpression' &&
      call.arguments.includes(ancestor) &&
      BROWSER_CALLS.has(calleePath(call.callee)?.at(-1))
    )
      return true;
  }
  return false;
}

/** An initial value that only marks "not yet": `0`, `null`, `undefined`. */
function placeholder(value) {
  return (
    (value.type === 'Literal' && (value.value === 0 || value.value === null)) ||
    (value.type === 'Identifier' && value.name === 'undefined')
  );
}

/** An expression without the wrappers that keep its value: `await`, `!`, `as`, `?.`. */
function unwrapped(node) {
  let current = node;
  while (
    ['AwaitExpression', 'TSNonNullExpression', 'TSAsExpression', 'ChainExpression'].includes(current.type)
  )
    current = current.type === 'AwaitExpression' ? current.argument : current.expression;
  return current;
}

/** The matchers that hold a value below a bound, and those that hold it above one. */
const BELOW_MATCHERS = new Set(['toBeLessThan', 'toBeLessThanOrEqual']);
const ABOVE_MATCHERS = new Set(['toBeGreaterThan', 'toBeGreaterThanOrEqual']);

/** The `expect(...)` call a matcher chain starts from (`expect(x).not.toBe…`, `expect.soft(x).toBe…`), or null. */
function expectCallOf(matcher) {
  let node = matcher.callee.object;
  let negated = false;
  while (node?.type === 'MemberExpression') {
    if (!node.computed && node.property.type === 'Identifier' && node.property.name === 'not')
      negated = !negated;
    node = node.object;
  }
  if (node?.type !== 'CallExpression') return null;
  const name = calleePath(node.callee)?.join('.');
  return name === 'expect' || name === 'expect.soft' ? { call: node, negated } : null;
}

/** The statements an `if` runs when its test holds; a throw among them makes the test a failure condition. */
function throwsWhenTrue(statement) {
  const body = statement.consequent;
  return (
    body.type === 'ThrowStatement' ||
    (body.type === 'BlockStatement' && body.body.some((inner) => inner.type === 'ThrowStatement'))
  );
}

/**
 * A test holds no wall-clock duration below a fixed number:
 * `expect(elapsed).toBeLessThan(250)`, `expect(Date.now() - start < 250).toBe(true)`,
 * `expect(Date.now()).toBeLessThan(deadline)` with `deadline = Date.now() + 250`,
 * `if (elapsed > 250) throw`. A duration is a value computed from a clock read, directly, through
 * variables or through the property of an object that holds it; a bound is fixed when it reads
 * neither a clock nor a date. Comparing a clock reading with another, or with an instant, orders
 * events and passes. So does a read of a clock the test controls: the page's clock after
 * `page.clock.install` in a function the page runs, and `Date` after `setSystemTime`, in the test
 * or before each test of its group. A `.length` is a count. The measured scenarios own timing and
 * judge it outside the test (docs/technical/testing.md, "Deadlines and measured scenarios").
 *
 * Known limits, each with 0 occurrences on 2026-11-21:
 * - A controlled clock exempts more than it controls: `page.clock.setFixedTime()` exempts the
 *   page's `performance.now()`, `page.clock.install()` exempts reads on a page of another browser
 *   context, real time restored after `setSystemTime` keeps the exemption, and a hook that
 *   installs the page clock exempts the page reads before its `install()` too.
 * - A count read through a nested property (`sample.dimensions.rows`) or supplied through an
 *   object spread (`{ takenAt: Date.now(), ...counts }`) falls back to the whole object, so a
 *   timestamp beside it reports the count.
 * - Only a clock read inside the assertion counts as the later reading: an ordering of two
 *   readings held in variables (`expect(before).toBeLessThan(after + 250)`) reports as a limit.
 * - A deadline held in an object property (`window.deadline = Date.now() + 250`) is not read as a
 *   deadline.
 */
const noFixedTimeLimitRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      limit:
        'A test holds no wall-clock duration below a fixed number: it then passes or fails by the speed of the machine it runs on. Assert the outcome, drive a clock the test controls (page.clock, setSystemTime, an injected clock), or measure through a registered scenario (docs/technical/testing.md, "Deadlines and measured scenarios").',
    },
  },
  create(context) {
    const { sourceCode } = context;
    /** Each comparison to judge once every variable is known: the side held below the bound, and the bound. */
    const comparisons = [];
    /** Where the test controls a clock, and which: the function, or the whole file, and `page` or `process`. */
    const controlled = [];
    const below = (node, limited, bound) => comparisons.push({ node, limited, bound });
    /** `a < b` read as "a is held below b" when `holds` is true, or as a failure condition when false. */
    const relational = (node, expression, holds) => {
      if (expression.type !== 'BinaryExpression') return;
      const less = expression.operator === '<' || expression.operator === '<=';
      const more = expression.operator === '>' || expression.operator === '>=';
      if (!less && !more) return;
      const [small, large] =
        less === holds ? [expression.left, expression.right] : [expression.right, expression.left];
      below(node, small, large);
    };
    /** A clock read whose clock the test controls at that point. */
    const controlledRead = (node) =>
      controlled.some(({ region, clock, from }) => {
        if (node.range[0] < from) return false;
        let inside = false;
        for (let ancestor = node; ancestor && !inside; ancestor = ancestor.parent)
          inside = ancestor === region;
        if (!inside) return false;
        const browser = inBrowserCallback(node);
        return clock === 'page'
          ? browser
          : !browser && isClockRead(node) && calleePath(node.callee)?.[0] === 'Date';
      });
    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression' || node.callee.property.type !== 'Identifier') return;
        const matcher = node.callee.property.name;
        const start = expectCallOf(node);
        const [subject] = start?.call.arguments ?? [];
        const [bound] = node.arguments;
        if (!start || !subject) return;
        if (bound && (BELOW_MATCHERS.has(matcher) || ABOVE_MATCHERS.has(matcher))) {
          const holdsBelow = BELOW_MATCHERS.has(matcher) !== start.negated;
          if (holdsBelow) below(node, subject, bound);
          else below(node, bound, subject);
          return;
        }
        if (matcher === 'toBe' || matcher === 'toBeTruthy' || matcher === 'toBeFalsy') {
          const expected =
            matcher === 'toBe'
              ? bound?.type === 'Literal'
                ? bound.value
                : undefined
              : matcher === 'toBeTruthy';
          if (typeof expected === 'boolean') relational(node, subject, expected !== start.negated);
        }
      },
      IfStatement(node) {
        if (throwsWhenTrue(node)) relational(node, node.test, false);
      },
      'CallExpression:exit'(node) {
        const clock = controlledClock(node);
        if (!clock) return;
        let region = node.parent;
        while (region && !FUNCTION_TYPES.has(region.type)) region = region.parent;
        // A clock installed before each test controls every test of the enclosing group from its
        // start; one installed in a test controls the reads after the install.
        let from = node.range[1];
        const hook = region?.parent;
        if (hook?.type === 'CallExpression' && calleePath(hook.callee)?.at(-1) === 'beforeEach') {
          region = hook.parent;
          while (region && !FUNCTION_TYPES.has(region.type)) region = region.parent;
          from = 0;
        }
        controlled.push({ region: region ?? sourceCode.ast, clock, from });
      },
      'Program:exit'() {
        if (!comparisons.length) return;
        const variableOf = new Map();
        for (const scope of sourceCode.scopeManager.scopes)
          for (const reference of scope.references)
            if (reference.resolved) variableOf.set(reference.identifier, reference.resolved);
        const assigned = new Map();
        for (const scope of sourceCode.scopeManager.scopes)
          for (const variable of scope.variables)
            assigned.set(
              variable,
              variable.references.flatMap(({ identifier, writeExpr }) =>
                writeExpr ? [{ identifier, writeExpr }] : [],
              ),
            );
        /**
         * The object literals a value is, at its own level: a literal, a variable that holds one, or
         * what a page function returns (`page.evaluate(() => ({ ... }))`). Empty when it cannot say.
         */
        const literalsOf = (node, seen = new Set()) => {
          const value = unwrapped(node);
          if (value.type === 'ObjectExpression') return [value];
          if (value.type === 'Identifier') {
            const variable = variableOf.get(value);
            if (!variable || seen.has(variable)) return [];
            seen.add(variable);
            return (writesOf(variable) ?? []).flatMap((write) => literalsOf(write, seen));
          }
          if (value.type !== 'CallExpression') return [];
          return value.arguments
            .filter((argument) => FUNCTION_TYPES.has(argument.type))
            .flatMap((callback) =>
              callback.body.type === 'BlockStatement'
                ? callback.body.body
                    .filter((statement) => statement.type === 'ReturnStatement' && statement.argument)
                    .flatMap((statement) => literalsOf(statement.argument, seen))
                : literalsOf(callback.body, seen),
            );
        };
        /** What `value.key` holds, when every literal behind `value` names `key`; otherwise undefined. */
        const propertyOf = (value, key) => {
          const literals = literalsOf(value);
          const properties = literals.map((literal) =>
            literal.properties.find((property) => keyName(property) === key),
          );
          return literals.length && properties.every(Boolean)
            ? properties.map((property) => property.value)
            : undefined;
        };
        /** What each variable holds: a destructured property holds only that property of the value. */
        const writing = new Map();
        const writesOf = (variable) => {
          // A variable read while its own writes are being read holds nothing more.
          if (writing.has(variable)) return writing.get(variable) ?? [];
          writing.set(variable, undefined);
          const values = (assigned.get(variable) ?? []).flatMap(({ identifier, writeExpr }) => {
            // An initial placeholder (`let returnedAt = 0`, `null`) is no value the variable holds.
            const initial =
              identifier.parent?.type === 'VariableDeclarator' && identifier.parent.init === writeExpr;
            if (initial && placeholder(writeExpr)) return [];
            const property = identifier.parent;
            const key =
              property?.type === 'Property' &&
              property.value === identifier &&
              property.parent?.type === 'ObjectPattern'
                ? keyName(property)
                : null;
            return (key === null ? undefined : propertyOf(writeExpr, key)) ?? [writeExpr];
          });
          writing.set(variable, values);
          return values;
        };
        const clocked = new Set();
        const instants = new Set();
        /** Whether `root` reads what `read` names, directly or through a variable in `names`. */
        const reads = (root, read, names) => {
          let found = false;
          const stack = [root];
          // A property read can lead back to a node already read: `sample = { rows: sample.rows + 1 }`.
          const visited = new Set();
          while (stack.length && !found) {
            const node = stack.pop();
            if (!node || typeof node.type !== 'string' || visited.has(node)) continue;
            visited.add(node);
            if (read(node) || (node.type === 'Identifier' && names.has(variableOf.get(node)))) found = true;
            // `sample.rowCount` reads only what the literal behind `sample` puts there, when it says.
            const named =
              node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier'
                ? node.property.name
                : null;
            const held = named === null ? undefined : propertyOf(node.object, named);
            if (held) {
              stack.push(...held);
              continue;
            }
            // A length is a count, never a time: `samples.length` of `[Date.now()]`.
            if (named === 'length') continue;
            for (const [key, value] of Object.entries(node)) {
              if (key === 'parent') continue;
              if (Array.isArray(value)) stack.push(...value);
              else if (value && typeof value.type === 'string') stack.push(value);
            }
          }
          return found;
        };
        const readsClock = (root) =>
          reads(root, (node) => isDurationClockRead(node) && !controlledRead(node), clocked);
        /** A clock reading or an instant: the bound of an ordering, never a fixed limit. */
        const readsTime = (root) =>
          reads(root, (node) => isDurationClockRead(node) || isInstant(node), instants);
        // To a fixed point: `const now = Date.now(); const elapsed = now - start` reads the clock twice removed.
        /**
         * Whether every value an expression can take reads time: each branch of `a ? b : c` and
         * `a ?? b`, and each value the literal behind `limits.bound` puts there. A node met again
         * adds no value: `limits = { bound: limits.bound }`.
         */
        const alwaysTime = (node, seen = new Set()) => {
          const value = unwrapped(node);
          if (seen.has(value)) return true;
          seen.add(value);
          const always = (inner) => alwaysTime(inner, seen);
          if (value.type === 'ConditionalExpression')
            return always(value.consequent) && always(value.alternate);
          if (value.type === 'LogicalExpression') return always(value.left) && always(value.right);
          const held =
            value.type === 'MemberExpression' && !value.computed && value.property.type === 'Identifier'
              ? propertyOf(value.object, value.property.name)
              : undefined;
          return held ? held.every(always) : readsTime(value);
        };
        // A variable holds a duration when any write reads a clock, but counts as a time bound only
        // when every write does: `let limit = Date.now(); limit = 250` is a fixed limit.
        const holds = {
          clocked: (values) => values.some(readsClock),
          instants: (values) => values.length > 0 && values.every((value) => alwaysTime(value)),
        };
        for (const [names, held] of [
          [clocked, holds.clocked],
          [instants, holds.instants],
        ])
          for (let grown = true; grown; ) {
            grown = false;
            for (const variable of assigned.keys()) {
              if (names.has(variable) || !held(writesOf(variable))) continue;
              names.add(variable);
              grown = true;
            }
          }
        /**
         * Which way a clock reading moved by a fixed amount points: `+` for `Date.now() + 250`, a
         * deadline; `-` for `Date.now() - 250`, a start pushed back; null for anything else. A
         * variable that holds one, directly or through another, points the same way.
         */
        const offsetOf = (node, seen = new Set()) => {
          const value = unwrapped(node);
          if (value.type === 'Identifier') {
            const variable = variableOf.get(value);
            if (!variable || seen.has(variable)) return null;
            seen.add(variable);
            const offsets = writesOf(variable).map((write) => offsetOf(write, seen));
            return offsets.find((offset) => offset !== null) ?? null;
          }
          if (value.type !== 'BinaryExpression') return null;
          if (value.operator === '-' && readsClock(value.left) && !readsTime(value.right)) return '-';
          const fixedSum =
            (readsClock(value.left) && !readsTime(value.right)) ||
            (readsClock(value.right) && !readsTime(value.left));
          return value.operator === '+' && fixedSum ? '+' : null;
        };
        /** Whether `root` itself calls an uncontrolled clock, not through a variable: it reads the clock last. */
        const readsClockNow = (root) => {
          const stack = [root];
          while (stack.length) {
            const node = stack.pop();
            if (isDurationClockRead(node) && !controlledRead(node)) return true;
            for (const [key, value] of Object.entries(node)) {
              if (key === 'parent') continue;
              if (Array.isArray(value))
                stack.push(...value.filter((item) => item && typeof item.type === 'string'));
              else if (value && typeof value.type === 'string') stack.push(value);
            }
          }
          return false;
        };
        // Held below a deadline, a clock reading has an upper limit on its distance from the start
        // the deadline counts from; so has a clock reading pushed back, held below a start. The
        // other two orders set a lower limit, which a slower machine always meets. So does either
        // order when only the bound reads the clock in the assertion itself: that reading is the
        // later one, as in `expect(before).toBeLessThan(Date.now() + 250)`.
        for (const { node, limited, bound } of comparisons) {
          const ordering = readsClockNow(bound) && !readsClockNow(limited);
          if (
            (readsClock(limited) && (!alwaysTime(bound) || (offsetOf(bound) === '+' && !ordering))) ||
            (offsetOf(limited) === '-' && readsClock(bound) && !ordering)
          )
            context.report({ node, messageId: 'limit' });
        }
      },
    };
  },
};

/**
 * `.only` never lands. A skipped test (`skip`, `fixme`, `todo`, a runtime
 * `test.skip()`) carries the quarantine comment on the line above, outside the
 * refused paths, and a quarantine comment always sits above a skip.
 */
const noExcludedTestRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      focused:
        'A committed `.only` drops every other test from the run. Narrow a local run with the runner’s --grep or a file argument.',
      unquarantined:
        'A skipped test needs `// quarantine: werk-flow/werkflow-planning#<n> <why>` on the line above; the nightly run lists it until the issue brings it back.',
      malformed:
        'A quarantine comment reads `// quarantine: werk-flow/werkflow-planning#<n> <why>`: the planning issue that brings the test back, then why it is skipped.',
      refused:
        'A security, permission, SQL or action-boundary test is never quarantined: fix the test or the product, never skip the proof.',
      orphan: 'A quarantine comment sits on the line directly above the skipped test.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const file = relativePath(context);
    let refused = QUARANTINE_REFUSED_PATHS.some((prefix) => file.startsWith(prefix));
    const skipLines = new Set();
    const skipNodes = [];

    function commentAbove(line) {
      return sourceCode
        .getAllComments()
        .find((comment) => comment.type === 'Line' && comment.loc.end.line === line - 1);
    }
    const noteFixtureReference = (value) => {
      if (typeof value === 'string' && value.includes(BOUNDARY_FIXTURE_REFERENCE)) refused = true;
    };

    return {
      Literal(node) {
        noteFixtureReference(node.value);
      },
      TemplateElement(node) {
        noteFixtureReference(node.value.cooked);
      },
      CallExpression(node) {
        const path = calleePath(node.callee);
        if (!path) return;
        const owner = path.slice(0, -1);
        const ownedByTest = TEST_ROOTS.has(path[0]) || owner.includes('info()') || owner[0] === 'testInfo';
        if (!ownedByTest) return;
        const segments = path.slice(1).map((segment) => segment.replace(/\(\)$/, ''));
        if (TEST_ROOTS.has(path[0]) && segments.includes('only'))
          return context.report({ node, messageId: 'focused' });
        if (!segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return;
        skipLines.add(node.loc.start.line);
        skipNodes.push(node);
      },
      'Program:exit'() {
        for (const node of skipNodes) {
          if (refused) {
            context.report({ node, messageId: 'refused' });
            continue;
          }
          const comment = commentAbove(node.loc.start.line);
          if (!comment || !QUARANTINE_MARK.test(comment.value))
            context.report({ node, messageId: 'unquarantined' });
          else if (!QUARANTINE_COMMENT.test(comment.value)) context.report({ node, messageId: 'malformed' });
        }
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== 'Line' || !QUARANTINE_MARK.test(comment.value)) continue;
          if (!skipLines.has(comment.loc.end.line + 1))
            context.report({ loc: comment.loc, messageId: 'orphan' });
        }
      },
    };
  },
};

export const testHygieneRules = {
  rules: {
    'no-wall-clock-wait': noWallClockWaitRule,
    'no-polling-loop': noPollingLoopRule,
    'no-per-test-timeout': noPerTestTimeoutRule,
    'no-retries': noRetriesRule,
    'no-unpinned-clock': noUnpinnedClockRule,
    'no-fixed-time-limit': noFixedTimeLimitRule,
    'no-excluded-test': noExcludedTestRule,
  },
};
