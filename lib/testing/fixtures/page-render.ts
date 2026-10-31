// Renders a real App Router page over the action world as the server does: a
// redirect or a not-found ends the render, and each async server component
// runs with its props. Import a page only after `installPageWorld`.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { isValidElement, type ReactElement } from 'react';
import { installActionWorld, type ActionWorld } from './action-boundary-world';

export type Render = () => Promise<ReactElement> | ReactElement;
type ServerComponent = (props: unknown) => Promise<ReactElement | null>;

/** The action world, with a page's redirect and not-found ending the render as an error. */
export async function installPageWorld(
  ...world: Parameters<typeof installActionWorld>
): Promise<ActionWorld> {
  const navigation = { ...(await import('next/navigation')) };
  const installed = installActionWorld(...world);
  // The pages import client components, so the router hooks stay.
  mock.module('next/navigation', () => ({
    ...navigation,
    redirect: (path: string): never => {
      throw new Error(`redirect:${path}`);
    },
    notFound: (): never => {
      throw new Error('notFound');
    },
  }));
  return installed;
}

function isServerComponent(type: unknown): type is ServerComponent {
  return typeof type === 'function' && type.constructor.name === 'AsyncFunction';
}

/** The value at `path` below `value`, or `undefined` where a step is missing. */
export function field(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined,
    value,
  );
}

/** Runs the page and each async server component it returns, as the server renders them. */
export async function render(page: Render): Promise<ReactElement> {
  let element = await page();
  while (isServerComponent(element.type)) {
    const next = await element.type(element.props);
    assert.ok(next, 'the page rendered nothing');
    element = next;
  }
  return element;
}

// A method's parameter is bivariant, so a component with its own props type fits.
type SyncServerComponent = { render(props: unknown): unknown }['render'];
/** Server components that are not async; a client component never runs outside React. */
type SyncServerComponents = ReadonlySet<SyncServerComponent>;

async function collect(node: unknown, elements: ReactElement[], sync: SyncServerComponents): Promise<void> {
  if (Array.isArray(node)) {
    for (const child of node) await collect(child, elements, sync);
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  const { type } = node;
  if (isServerComponent(type)) return collect(await type(node.props), elements, sync);
  const syncComponent = [...sync].find((component) => component === type);
  if (syncComponent) return collect(syncComponent(node.props), elements, sync);
  elements.push(node);
  // A Suspense fallback is the loading state, not the page.
  for (const [key, value] of Object.entries(node.props))
    if (key !== 'fallback') await collect(value, elements, sync);
}

/**
 * Every element of the page in render order, each async server component
 * below a layout or a Suspense boundary run one after the other, and each
 * listed sync server component too.
 */
export async function renderTree(
  page: Render,
  sync: SyncServerComponents = new Set(),
): Promise<ReactElement[]> {
  const elements: ReactElement[] = [];
  await collect(await page(), elements, sync);
  return elements;
}

/** How the page refused: a redirect, a not-found, or a client-side route redirect. */
export async function refusal(page: Render, sync?: SyncServerComponents): Promise<string> {
  try {
    const [root] = await renderTree(page, sync);
    const href = field(root, 'props', 'href');
    assert.equal(typeof href, 'string', 'the page rendered');
    return `route-redirect:${String(href)}`;
  } catch (error) {
    if (error instanceof Error && /^(redirect:|notFound$)/.test(error.message)) return error.message;
    throw error;
  }
}
