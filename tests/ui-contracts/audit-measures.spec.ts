import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from '../audit/support/axe';
import { expectKeyboardPath } from '../audit/support/keyboard-path';
import { expectDialogFits, expectNoSidewaysOverflow } from '../audit/support/layout-measure';
import { trackLabNetwork } from '../audit/support/lab-network';

// Planted-defect proofs of the rendered audit's measures (werkflow-design,
// "Checklist"): each measure fails on a page that breaks its rule and passes
// on the same page repaired. The pages are plain markup, so a proof does not
// depend on a product screen staying broken.

const SHELL = (body: string) => `<!doctype html><html lang="de"><head><title>Probe</title>
<style>body{margin:0;font:16px sans-serif} *{box-sizing:border-box}
[role=dialog],[role=alertdialog]{position:fixed;left:20px;top:20px;width:300px;background:#fff;color:#111}</style></head>
<body><main><h1>Probe</h1><div data-page-body style="width:360px;overflow:hidden">${body}</div></main></body></html>`;

async function show(page: Page, body: string): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(SHELL(body));
}

test('the dialog measure fails on a wide, a too tall and a clipped dialog, and passes a fitting one', async ({
  page,
}) => {
  const dialog = page.getByRole('dialog');
  await show(page, '<div role="dialog" aria-label="Probe"><div style="width:600px">Zu breit</div></div>');
  await expect(expectDialogFits(dialog, 'wide')).rejects.toThrow(/scrolls sideways|leaves the dialog/);
  await show(page, '<div role="dialog" aria-label="Probe" style="height:1200px">Zu hoch</div>');
  await expect(expectDialogFits(dialog, 'tall')).rejects.toThrow(/lies inside the 375x812 viewport/);
  await show(
    page,
    '<div role="dialog" aria-label="Probe" style="height:200px;overflow:hidden"><p style="margin-top:400px">Abgeschnitten</p></div>',
  );
  await expect(expectDialogFits(dialog, 'clipped')).rejects.toThrow(/without a vertical scroll region/);
  await show(
    page,
    '<div role="dialog" aria-label="Probe" style="height:200px;display:flex;flex-direction:column"><div data-slot="dialog-body" style="flex:1;overflow-y:auto"><p style="margin-top:400px">Erreichbar</p></div><div data-slot="dialog-footer"><button>Speichern</button></div></div>',
  );
  await expectDialogFits(dialog, 'fitting');
});

test('the page measure fails on an unnamed sideways scroller and passes a named region', async ({ page }) => {
  await show(page, '<div style="overflow-x:auto"><div style="width:900px">Breite Tabelle</div></div>');
  // An unnamed scroller no longer excuses what it hides, so its content counts as past the edge too.
  await expect(expectNoSidewaysOverflow(page, 'unnamed')).rejects.toThrow(
    /past the right edge|without a scroll-region name/,
  );
  await show(
    page,
    '<div data-scroll-region="tab-strip" style="overflow-x:auto"><div style="width:900px">Reiter</div></div>',
  );
  await expectNoSidewaysOverflow(page, 'named');
  // A table may scroll only from the tablet breakpoint; on a phone it is a card list.
  await show(
    page,
    '<div data-scroll-region="table" style="overflow-x:auto"><div style="width:900px">Tabelle</div></div>',
  );
  await expect(expectNoSidewaysOverflow(page, 'table on a phone')).rejects.toThrow(
    /does not allow at this width/,
  );
});

test('the axe pass fails on an unnamed button and passes a named one', async ({ page }) => {
  await show(page, '<button></button>');
  await expect(expectNoAxeViolations(page, 'unnamed')).rejects.toThrow(/button-name/);
  await show(page, '<button>Speichern</button>');
  await expectNoAxeViolations(page, 'named');
});

test('the keyboard path fails when focus stays outside the dialog or Tab leaves it', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  await show(
    page,
    '<button>Öffnen</button><div role="dialog" aria-label="Probe"><input aria-label="Name"><button>Speichern</button></div>',
  );
  await page.getByRole('button', { name: 'Öffnen' }).focus();
  await expect(expectKeyboardPath(page, dialog, 'outside', { soft: false })).rejects.toThrow(
    /focus starts on the first control or the dialog/,
  );
  await page.getByRole('textbox', { name: 'Name' }).focus();
  // Without a focus trap the third Tab leaves the plain dialog: the path fails there too.
  await expect(expectKeyboardPath(page, dialog, 'untrapped', { soft: false })).rejects.toThrow(
    /moved focus out of the dialog/,
  );
});

test('the lab network read keeps the rows of a read that replaced an aborted one', async ({ page }) => {
  const origin = 'http://lab.test';
  const board = JSON.stringify({ rows: Array.from({ length: 90 }, (_, index) => ({ index })) });
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/'))
      return route.fulfill({ contentType: 'text/html', body: SHELL('') });
    // The superseded read never answers; the page aborts it.
    if (url.searchParams.has('superseded')) return;
    return route.fulfill({ contentType: 'application/json', body: board });
  });
  await page.goto(`${origin}/`);
  const network = await trackLabNetwork(await page.context().newCDPSession(page), origin);
  network.reset();

  await page.evaluate(async () => {
    const superseded = new AbortController();
    void fetch('/api/calendar-board?superseded', { signal: superseded.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    superseded.abort();
    await (await fetch('/api/calendar-board?current')).json();
  });
  await expect.poll(() => network.inFlight()).toEqual([]);
  await expect.poll(() => network.quietForMs()).toBeGreaterThan(100);

  const payload = network.read().payloads.find((entry) => entry.shape === 'api:/api/calendar-board');
  expect(payload).toMatchObject({ requests: 2, rows: 90 });
});
