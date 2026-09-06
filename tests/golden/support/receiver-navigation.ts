import type { Frame, Page, Request } from "@playwright/test";
import { invalidatesLiveObservation } from "../../../lib/testing/live-observation";

/** Playwright also emits framenavigated for same-document History API calls. */
export function subscribeReceiverNavigation(receiver: Page, onNavigation: () => void): () => void {
  const initialUrl = receiver.url();
  const listener = (frame: Frame): void => {
    if (frame === receiver.mainFrame() && invalidatesLiveObservation({
      initialUrl, event: { kind: "frame-location", url: frame.url() },
    })) onNavigation();
  };
  const requestListener = (request: Request): void => {
    if (request.isNavigationRequest() && request.frame() === receiver.mainFrame()
      && invalidatesLiveObservation({
        initialUrl, event: { kind: "document-request", url: request.url() },
      })) onNavigation();
  };
  receiver.on("request", requestListener);
  receiver.on("framenavigated", listener);
  return () => {
    receiver.off("request", requestListener);
    receiver.off("framenavigated", listener);
  };
}
