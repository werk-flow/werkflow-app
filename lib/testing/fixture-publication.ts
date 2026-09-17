export type FixturePublicationObserver = {
  ready: () => void;
  marker: () => void;
  failed: (error: Error) => void;
};

/** Setup ends only after both the write response and its ordered Realtime receipt. */
export async function waitForFixturePublication(options: {
  subscribe: (observer: FixturePublicationObserver) => () => Promise<void>;
  write: () => Promise<void>;
  timeoutMs?: number;
}): Promise<void> {
  let dispose: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let started = false;
      let committed = false;
      let received = false;
      const failed = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const finish = (): void => {
        if (settled || !committed || !received) return;
        settled = true;
        resolve();
      };
      timer = setTimeout(() => failed(new Error("Fixture Realtime publication did not complete before its setup deadline.")), options.timeoutMs ?? 60_000);
      dispose = options.subscribe({
        ready: () => {
          if (settled || started) return;
          started = true;
          void Promise.resolve().then(async () => {
            if (settled) return;
            await options.write();
            committed = true;
            finish();
          }).catch(failed);
        },
        marker: () => {
          if (!started) return;
          received = true;
          finish();
        },
        failed,
      });
    });
  } finally {
    settled = true;
    clearTimeout(timer);
    await dispose?.();
  }
}
