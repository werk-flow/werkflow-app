'use client';

import { useState } from 'react';
import { Share, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

const DISMISSED_KEY = 'werkflow:ios-install-hint-dismissed';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // best-effort: a browser that refuses storage shows the hint again on the next start.
    return null;
  }
}

function wasDismissed(): boolean {
  try {
    return storage()?.getItem(DISMISSED_KEY) === '1';
  } catch {
    // best-effort: an unreadable flag shows the hint, which the person can close again.
    return false;
  }
}

/**
 * How to install WerkFlow on an iPhone or iPad, whose browsers offer no
 * install prompt: only the Share menu adds it to the home screen. The app
 * shell loads this module for the field role on iOS outside the installed
 * app only. Closing it keeps it closed on this device.
 */
export function IosInstallHint() {
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      storage()?.setItem(DISMISSED_KEY, '1');
    } catch {
      // best-effort: the hint stays closed in this page and returns on the next start.
    }
  };

  return (
    <aside
      aria-label="WerkFlow installieren"
      className="absolute inset-x-4 top-4 z-20 mx-auto max-w-md rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="flex items-start gap-3">
        <Share className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">WerkFlow auf den Home-Bildschirm legen</p>
          <p className="mt-1 text-muted-foreground">
            Tippe in der Browserleiste auf „Teilen“ und dann auf „Zum Home-Bildschirm“. Danach öffnest du
            WerkFlow direkt wie eine App.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-2 -mr-2 size-11"
          aria-label="Installationshinweis schließen"
          onClick={dismiss}
        >
          <X />
        </Button>
      </div>
    </aside>
  );
}
