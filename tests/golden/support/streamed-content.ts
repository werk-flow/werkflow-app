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
 */
export async function revealStreamedContentBeforeEachStep(page: Page): Promise<void> {
  await page.addLocatorHandler(page.locator(`body:has(${STREAMED_SEGMENT})`), async () => {
    await expect(
      page.locator(STREAMED_SEGMENT),
      'React reveals the content it streamed after the load',
    ).toHaveCount(0);
  });
}

/** A new page of the context whose steps wait for React's reveal after every load. */
export async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await revealStreamedContentBeforeEachStep(page);
  return page;
}
