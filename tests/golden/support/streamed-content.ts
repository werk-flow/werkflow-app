import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createRolePage } from './sessions';

/**
 * React's hidden container for a Suspense boundary's streamed content, at the
 * end of `<body>` until the batched reveal moves the content into place.
 */
const STREAMED_SEGMENT = 'div[hidden][id^="S:"]';

/**
 * React reveals streamed content up to 300 ms after its boundary completes;
 * the traced runs showed the reveal within 350 ms of the load. Half the
 * configured expect timeout.
 */
const STREAMED_REVEAL_TIMEOUT_MS = 5_000;

/**
 * Makes every `goto` and `reload` of the page return only once React revealed
 * the content it streamed (docs/technical/integrated-test-state.md, "Keep the
 * page stable during a step").
 *
 * After a document load React keeps each Suspense boundary's streamed content
 * in a hidden container and reveals a batch of them up to 300 ms later. When
 * an update reaches such a boundary first, React renders the content on the
 * client too, and the document holds a shown and a hidden copy until the
 * reveal removes the streamed one. A lookup by id, text, label, placeholder,
 * test id or selector then matches both and fails strict mode, only when the
 * timing puts the copy there.
 *
 * The wait ends the navigation, so no other step of the test runs beside it,
 * and the document is parsed by then, so no container arrives after it. A
 * document load that a click starts is not covered; the lookup rule
 * (`playwright-spec/visible-page-lookup`) is.
 */
export function revealStreamedContentAfterEachLoad(page: Page): void {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (url, options) => {
    const response = await goto(url, options);
    await expectStreamedContentRevealed(page);
    return response;
  };
  page.reload = async (options) => {
    const response = await reload(options);
    await expectStreamedContentRevealed(page);
    return response;
  };
}

/**
 * Waits until no streamed container is left. The check retries in whichever
 * document the page shows, so a redirect or a reload under it only moves the
 * wait to the new document. A container that stays (a boundary that never
 * resolves, an error boundary that replaced its content, a container React
 * left behind) fails with each container's id and the start of its text.
 */
async function expectStreamedContentRevealed(page: Page): Promise<void> {
  const segments = page.locator(STREAMED_SEGMENT);
  try {
    await expect(segments).toHaveCount(0, { timeout: STREAMED_REVEAL_TIMEOUT_MS });
  } catch (error) {
    let pending: string;
    try {
      const names = await segments.evaluateAll((elements) =>
        elements.map((element) => `${element.id} "${(element.textContent ?? '').trim().slice(0, 60)}"`),
      );
      pending = names.join(', ');
    } catch (readError) {
      pending = `the containers could not be read: ${String(readError)}`;
    }
    throw new Error(`React reveals the content it streamed after the load; still hidden: ${pending}`, {
      cause: error,
    });
  }
}

/** A signed-in page of the role, in its own context, whose loads wait for React's reveal. */
export async function openRolePage(
  input: Parameters<typeof createRolePage>[0],
): ReturnType<typeof createRolePage> {
  const opened = await createRolePage(input);
  revealStreamedContentAfterEachLoad(opened.page);
  return opened;
}

/** A new page of the context whose loads wait for React's reveal. */
export async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  revealStreamedContentAfterEachLoad(page);
  return page;
}
