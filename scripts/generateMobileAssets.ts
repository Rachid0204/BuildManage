import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

const ROOT = process.cwd();
const SVG_PATH = path.join(ROOT, 'public', 'icons', 'syndik-icon.svg');
const RESOURCES_DIR = path.join(ROOT, 'resources');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const IOS_ASSETS = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');

function resolveChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  if (existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (existsSync('/usr/bin/chromium-browser')) return '/usr/bin/chromium-browser';
  return undefined;
}

async function renderSquareIcon(
  page: Page,
  svgMarkup: string,
  size: number,
  outPath: string,
  options: {
    background?: string;
    paddingRatio?: number;
    circular?: boolean;
  } = {},
): Promise<void> {
  mkdirSync(path.dirname(outPath), { recursive: true });
  await page.setViewportSize({ width: size, height: size });
  const padPx = Math.round(size * (options.paddingRatio ?? 0));
  const innerSize = size - padPx * 2;
  const bg = options.background ?? 'transparent';
  const radiusCss = options.circular ? 'border-radius: 50%;' : '';
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
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .canvas {
        width: ${size}px;
        height: ${size}px;
        background: ${bg};
        ${radiusCss}
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      svg {
        width: ${innerSize}px;
        height: ${innerSize}px;
        display: block;
      }
    </style>
  </head>
  <body><div class="canvas">${svgMarkup}</div></body>
</html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({
    path: outPath,
    type: 'png',
    omitBackground: bg === 'transparent' || Boolean(options.circular),
  });
}

async function renderSplash(
  page: Page,
  svgMarkup: string,
  width: number,
  height: number,
  outPath: string,
  dark: boolean,
): Promise<void> {
  mkdirSync(path.dirname(outPath), { recursive: true });
  await page.setViewportSize({ width, height });
  const minDim = Math.min(width, height);
  const iconSize = Math.round(minDim * 0.24);
  const titleSize = Math.round(minDim * 0.048);
  const subSize = Math.round(minDim * 0.02);
  const bg = dark
    ? 'radial-gradient(circle at 50% 38%, #134e4a 0%, #0f172a 68%, #020617 100%)'
    : 'linear-gradient(150deg, #0f766e 0%, #0d5c57 48%, #042f2e 100%)';

  const html = `<!doctype html>
<html>
  <head>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: ${bg};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #ffffff;
      }
      .badge {
        width: ${iconSize}px;
        height: ${iconSize}px;
        border-radius: ${Math.round(iconSize * 0.22)}px;
        background: rgba(255, 255, 255, 0.12);
        border: ${Math.max(2, Math.round(iconSize * 0.015))}px solid rgba(255, 255, 255, 0.24);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 ${Math.round(iconSize * 0.08)}px ${Math.round(iconSize * 0.2)}px rgba(0, 0, 0, 0.28);
      }
      .badge svg {
        width: ${Math.round(iconSize * 0.78)}px;
        height: ${Math.round(iconSize * 0.78)}px;
        display: block;
      }
      .title {
        margin-top: ${Math.round(minDim * 0.036)}px;
        font-size: ${titleSize}px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .subtitle {
        margin-top: ${Math.round(minDim * 0.012)}px;
        font-size: ${subSize}px;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(204, 251, 241, 0.9);
      }
    </style>
  </head>
  <body>
    <div class="badge">${svgMarkup}</div>
    <div class="title">SyndicUnion</div>
    <div class="subtitle">Copropriété · Loi 18-00 &amp; 106-12</div>
  </body>
</html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: outPath, type: 'png', omitBackground: false });
}

async function main() {
  mkdirSync(RESOURCES_DIR, { recursive: true });
  const svgMarkup = readFileSync(SVG_PATH, 'utf8');
  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  const brandBg = 'linear-gradient(135deg, #0f766e 0%, #042f2e 100%)';

  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });

    // 1. Canonical high-res store & Capacitor source assets
    const iconOnlyPath = path.join(RESOURCES_DIR, 'icon-only.png');
    await renderSquareIcon(page, svgMarkup, 1024, iconOnlyPath, {
      background: brandBg,
      paddingRatio: 0.08,
    });
    await renderSquareIcon(
      page,
      svgMarkup,
      1024,
      path.join(RESOURCES_DIR, 'icon-foreground.png'),
      {
        background: 'transparent',
        paddingRatio: 0.2,
      },
    );
    await renderSquareIcon(
      page,
      '',
      1024,
      path.join(RESOURCES_DIR, 'icon-background.png'),
      { background: brandBg },
    );
    const splashPath = path.join(RESOURCES_DIR, 'splash.png');
    await renderSplash(page, svgMarkup, 2732, 2732, splashPath, false);
    await renderSplash(
      page,
      svgMarkup,
      2732,
      2732,
      path.join(RESOURCES_DIR, 'splash-dark.png'),
      true,
    );

    // 2. Native Android mipmap launcher icons (legacy, round & adaptive foreground)
    if (existsSync(ANDROID_RES)) {
      const densities: Array<{ name: string; legacy: number; adaptive: number }> = [
        { name: 'mdpi', legacy: 48, adaptive: 108 },
        { name: 'hdpi', legacy: 72, adaptive: 162 },
        { name: 'xhdpi', legacy: 96, adaptive: 216 },
        { name: 'xxhdpi', legacy: 144, adaptive: 324 },
        { name: 'xxxhdpi', legacy: 192, adaptive: 432 },
      ];
      for (const d of densities) {
        const dir = path.join(ANDROID_RES, `mipmap-${d.name}`);
        await renderSquareIcon(page, svgMarkup, d.legacy, path.join(dir, 'ic_launcher.png'), {
          background: brandBg,
          paddingRatio: 0.08,
        });
        await renderSquareIcon(
          page,
          svgMarkup,
          d.legacy,
          path.join(dir, 'ic_launcher_round.png'),
          {
            background: brandBg,
            paddingRatio: 0.12,
            circular: true,
          },
        );
        await renderSquareIcon(
          page,
          svgMarkup,
          d.adaptive,
          path.join(dir, 'ic_launcher_foreground.png'),
          {
            background: 'transparent',
            paddingRatio: 0.22,
          },
        );
      }

      // Android splash drawables
      const androidSplashes: Array<{ rel: string; w: number; h: number }> = [
        { rel: 'drawable/splash.png', w: 480, h: 320 },
        { rel: 'drawable-port-mdpi/splash.png', w: 320, h: 480 },
        { rel: 'drawable-port-hdpi/splash.png', w: 480, h: 800 },
        { rel: 'drawable-port-xhdpi/splash.png', w: 720, h: 1280 },
        { rel: 'drawable-port-xxhdpi/splash.png', w: 960, h: 1600 },
        { rel: 'drawable-port-xxxhdpi/splash.png', w: 1280, h: 1920 },
        { rel: 'drawable-land-mdpi/splash.png', w: 480, h: 320 },
        { rel: 'drawable-land-hdpi/splash.png', w: 800, h: 480 },
        { rel: 'drawable-land-xhdpi/splash.png', w: 1280, h: 720 },
        { rel: 'drawable-land-xxhdpi/splash.png', w: 1600, h: 960 },
        { rel: 'drawable-land-xxxhdpi/splash.png', w: 1920, h: 1280 },
      ];
      for (const s of androidSplashes) {
        await renderSplash(page, svgMarkup, s.w, s.h, path.join(ANDROID_RES, s.rel), false);
      }
      console.log('Synced native Android launcher icons and splash drawables.');
    }

    // 3. Native iOS AppIcon (1024x1024 opaque) & Splash.imageset
    if (existsSync(IOS_ASSETS)) {
      copyFileSync(
        iconOnlyPath,
        path.join(IOS_ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'),
      );
      for (const file of [
        'splash-2732x2732.png',
        'splash-2732x2732-1.png',
        'splash-2732x2732-2.png',
      ]) {
        copyFileSync(splashPath, path.join(IOS_ASSETS, 'Splash.imageset', file));
      }
      console.log('Synced native iOS AppIcon and Splash.imageset.');
    }

    console.log('Generated SyndicUnion mobile assets successfully.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
