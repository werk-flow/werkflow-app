import { expect, type Locator, type Page } from '@playwright/test';

type ButtonContrast = { ratio: number; foreground: string; background: string };

/** Measures enabled solid-color button text; gradients and group opacity need a separate audit. */
async function measureButtonContrast(button: Locator): Promise<ButtonContrast> {
  return button.evaluate((element) => {
    type Color = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('Cannot resolve rendered button colors to sRGB.');

    function parseColor(value: string): Color {
      const components = /^rgba?\(([^)]+)\)$/.exec(value)?.[1]
        .split(/[\s,/]+/).filter(Boolean);
      if (components && (components.length === 3 || components.length === 4)) {
        const channels = components.slice(0, 3).map((part) =>
          part.endsWith('%') ? Number.parseFloat(part) / 100 : Number(part) / 255);
        const alpha = components[3];
        return [channels[0], channels[1], channels[2], alpha === undefined ? 1 :
          alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number(alpha)];
      }
      // Tailwind color-mix may compute to color(srgb ...). The browser's
      // sRGB canvas performs the same color-space conversion used to render it.
      if (!CSS.supports('color', value)) throw new Error(`Unsupported computed color: ${value}`);
      context!.clearRect(0, 0, 1, 1);
      context!.fillStyle = value;
      context!.fillRect(0, 0, 1, 1);
      const channels = context!.getImageData(0, 0, 1, 1).data;
      return [channels[0] / 255, channels[1] / 255, channels[2] / 255, channels[3] / 255];
    }

    function composite(front: Color, back: Color): Color {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      const channel = (index: number): number =>
        (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha;
      return [channel(0), channel(1), channel(2), alpha];
    }

    function luminance(color: Color): number {
      const linear = color.slice(0, 3).map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }

    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    let background: Color = [1, 1, 1, 1];
    for (const ancestor of ancestors) {
      const style = getComputedStyle(ancestor);
      if (style.backgroundImage !== 'none' || Number(style.opacity) !== 1 ||
          style.filter !== 'none' || style.mixBlendMode !== 'normal') {
        throw new Error('Button contrast probe only supports solid backgrounds without opacity groups, filters or blend modes.');
      }
      background = composite(parseColor(style.backgroundColor), background);
    }
    const style = getComputedStyle(element);
    const foreground = composite(parseColor(style.color), background);
    const light = luminance(foreground);
    const dark = luminance(background);
    return {
      ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
      foreground: style.color,
      background: style.backgroundColor,
    };
  });
}

export async function expectButtonTextContrast(page: Page, button: Locator): Promise<void> {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  const originalScheme = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  async function check(scheme: string, state: string): Promise<void> {
    await expect.poll(() => button.evaluate((element) => {
      let pending = 0;
      for (let current: Element | null = element; current; current = current.parentElement) {
        pending += current.getAnimations().filter(
          (animation) => animation.playState === 'running' || animation.pending,
        ).length;
      }
      return pending;
    }), { timeout: 5_000 }).toBe(0);
    const measured = await measureButtonContrast(button);
    expect(measured.ratio, `${scheme}/${state}: ${measured.foreground} on ${measured.background}`).toBeGreaterThanOrEqual(4.5);
  }
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.mouse.move(0, 0);
      await check(scheme, 'default');
      await button.hover();
      await check(scheme, 'hover');
      await page.mouse.down();
      try {
        expect(await button.evaluate((element) => element.matches(':active'))).toBe(true);
        await check(scheme, 'pressed');
      } finally {
        // Release outside the control so measuring :active never clicks or submits it.
        await page.mouse.move(0, 0);
        await page.mouse.up();
      }
    }
  } finally {
    await page.emulateMedia({ colorScheme: originalScheme });
  }
}
