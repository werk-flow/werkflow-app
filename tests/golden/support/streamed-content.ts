import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * React's hidden container for a Suspense boundary's streamed content, at the
 * end of `<body>` until the batched reveal moves the content into place.
 */
export const STREAMED_SEGMENT = 'div[hidden][id^="S:"]';

/**
 * Holds every step of the page until React revealed the content it streamed
 * after a load (docs/technical/integrated-test-state.md, "Keep the page stable
 * during a step").
 *
 * After a document load React keeps each Suspense boundary's streamed content
 * in a hidden container and reveals a batch of them up to 300 ms later. When
 * an update reaches such a boundary first, React renders the content on the
 * client too, and the document holds a shown and a hidden copy until the
 * reveal removes the streamed one. A lookup by id, text, label, placeholder,
 * test id or selector then matches both and fails strict mode, only when the
 * timing puts the copy there.
 *
 * The handler runs before every action and every retrying assertion on the
 * page while a streamed container is left, from any navigation that loads a
 * document. A one-shot read (`count`, `getAttribute`, `textContent`,
 * `evaluate`) does not trigger it.
 *
 * A container that stays (a boundary that never resolves, an error boundary
 * that replaced its content, a container React left behind) fails the test
 * after STREAMED_REVEAL_TIMEOUT_MS with a message that names each container
 * and the start of its text. The held step then fails at its own timeout: it
 * never passes on such a page.
 */
export async function revealStreamedContentBeforeEachStep(page: Page): Promise<void> {
  await page.addLocatorHandler(page.locator(`body:has(${STREAMED_SEGMENT})`), () =>
    expectStreamedContentRevealed(page),
  );
}

/**
 * React reveals streamed content up to 300 ms after its boundary completes;
 * both failed runs showed the reveal within 350 ms of the load. Half the
 * configured expect timeout, so a held step's default wait outlasts it.
 */
const STREAMED_REVEAL_TIMEOUT_MS = 5_000;

/** Fails, naming each container and the start of its text, when React has not revealed every streamed container in time. */
export async function expectStreamedContentRevealed(page: Page): Promise<void> {
  const segments = page.locator(STREAMED_SEGMENT);
  const pending = await segments.evaluateAll((elements) =>
    elements.map((element) => `${element.id} "${(element.textContent ?? '').trim().slice(0, 60)}"`),
  );
  await expect(
    segments,
    `React reveals the content it streamed after the load; still hidden: ${pending.join(', ')}`,
  ).toHaveCount(0, { timeout: STREAMED_REVEAL_TIMEOUT_MS });
}

/** A new page of the context whose steps wait for React's reveal after every load. */
export async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await revealStreamedContentBeforeEachStep(page);
  return page;
}
