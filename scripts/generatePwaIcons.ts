import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const ICONS_DIR = path.join(ROOT, 'public', 'icons');
const SVG_PATH = path.join(ICONS_DIR, 'syndicunion-icon.svg');

function resolveChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  if (existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (existsSync('/usr/bin/chromium-browser')) return '/usr/bin/chromium-browser';
  if (existsSync('/usr/bin/google-chrome')) return '/usr/bin/google-chrome';
  return undefined;
}

async function renderIcon(
  page: import('@playwright/test').Page,
  svgMarkup: string,
  size: number,
  outputName: string,
  options: { fullBleedBg?: string; paddingRatio?: number } = {},
) {
  await page.setViewportSize({ width: size, height: size });
  const padPx = Math.round(size * (options.paddingRatio ?? 0));
  const innerSize = size - padPx * 2;
  const html = `<!doctype html>
<html>
  <head>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: ${size}px;
        height: ${size}px;
        overflow: hidden;
        background: ${options.fullBleedBg ?? 'transparent'};
        display: flex;
        align-items: center;
        justify-content: center;
      }
      svg {
        width: ${innerSize}px;
        height: ${innerSize}px;
        display: block;
      }
    </style>
  </head>
  <body>${svgMarkup}</body>
</html>`;
  await page.setContent(html, { waitUntil: 'load' });
  const outPath = path.join(ICONS_DIR, outputName);
  await page.screenshot({
    path: outPath,
    type: 'png',
    omitBackground: !options.fullBleedBg,
  });
  console.log(`Generated ${path.relative(ROOT, outPath)} (${size}x${size})`);
}

async function main() {
  mkdirSync(ICONS_DIR, { recursive: true });
  const svgMarkup = readFileSync(SVG_PATH, 'utf8');
  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await renderIcon(page, svgMarkup, 32, 'favicon-32x32.png');
    await renderIcon(page, svgMarkup, 192, 'icon-192.png');
    await renderIcon(page, svgMarkup, 512, 'icon-512.png');
    // Maskable icon: full-bleed Atlas Emerald background with 12% safe-zone inset for Android adaptive masks
    await renderIcon(page, svgMarkup, 512, 'icon-maskable-512.png', {
      fullBleedBg: 'linear-gradient(135deg, #0f766e 0%, #042f2e 100%)',
      paddingRatio: 0.12,
    });
    // Apple Touch Icon: iOS adds its own rounded mask, so provide a solid full-bleed background
    await renderIcon(page, svgMarkup, 180, 'apple-touch-icon.png', {
      fullBleedBg: 'linear-gradient(135deg, #0f766e 0%, #042f2e 100%)',
      paddingRatio: 0.04,
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
