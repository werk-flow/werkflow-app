/**
 * Bounds a route-interception gate without waiting on Playwright's request
 * event, which may remain pending until the intercepted route is continued.
 */
export async function waitForRouteIntercept(
  intercepted: Promise<void>
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      intercepted,
      new Promise<void>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Route handler did not observe the request.'));
        }, 15_000);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
