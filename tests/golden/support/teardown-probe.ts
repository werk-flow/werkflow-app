// TEMPORARY DIAGNOSTIC (never committed): records what happens to a role page before its context closes.
import type { Browser, BrowserContext, Page } from '@playwright/test';

export type ProbeLog = string[];

export function watch(label: string, browser: Browser, context: BrowserContext, page: Page, log: ProbeLog): void {
  const t0 = Date.now();
  const at = (event: string) => log.push(`${label} +${Date.now() - t0}ms ${event}`);
  page.on('crash', () => at('page crash'));
  page.on('close', () => at('page close'));
  page.on('pageerror', (e) => at(`pageerror ${e.message.slice(0, 120)}`));
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) at(`nav ${new URL(f.url()).pathname}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') at(`console.error ${m.text().slice(0, 120)}`);
  });
  context.on('close', () => at('context close event'));
  context.on('serviceworker', (w) => {
    at(`serviceworker ${new URL(w.url()).pathname}`);
    w.on('close', () => at('serviceworker close'));
  });
  context.on('page', (p) => at(`extra page ${p.url()}`));
  browser.on('disconnected', () => at('browser disconnected'));
}
