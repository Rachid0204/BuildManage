import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

let server: Server, origin: string;
test.beforeAll(async () => {
  const bundle = await build({ entryPoints: [resolve('tests/helpers/settingsDraftHarness.tsx')], bundle: true,
    write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  server = createServer((request, response) => {
    if (request.url === '/settings-harness.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(bundle.outputFiles[0].text);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/settings-harness.js"></script></body></html>');
    }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await expect(page.locator('#companyName')).toHaveValue('Syndic Al Manar');
});
const dirty = (page: Page) => page.getByText('Modifications non enregistrées', { exact: true });
const conflict = (page: Page) => page.getByRole('status').filter({ hasText: 'changé à distance' });
const save = (page: Page) => page.locator('button[type=submit]');
async function incoming(page: Page, button: string) {
  const previous = Number(await page.getByTestId('applied-version').textContent());
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByTestId('applied-version')).toHaveText(String(previous + 1));
}

test('Settings draft: unrelated live replacements preserve all six unsaved fields', async ({ page }) => {
  const values = { companyName: 'Syndic Al Manar Updated', logoUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    ice: '123456789012345', taxId: 'LOCAL-TAX', rc: 'LOCAL-RC', patente: 'LOCAL-PAT' };
  for (const [id, value] of Object.entries(values)) await page.locator(`#${id}`).fill(value);
  await incoming(page, 'Unrelated live update');
  for (const [id, value] of Object.entries(values)) await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect(dirty(page)).toBeVisible(); await expect(conflict(page)).toHaveCount(0);
});

test('Settings draft: clean fields hydrate while dirty conflicts preserve input and offer both resolutions', async ({ page }) => {
  await page.locator('#companyName').fill('My local cabinet');
  await incoming(page, 'Incoming Settings update');
  await expect(page.locator('#companyName')).toHaveValue('My local cabinet');
  await expect(page.locator('#taxId')).toHaveValue('REMOTE-TAX-1');
  await expect(conflict(page)).toBeVisible();
  await conflict(page).getByRole('button', { name: /Conserver ma version/ }).click();
  await expect(conflict(page)).toHaveCount(0); await expect(dirty(page)).toBeVisible();
  await page.getByRole('textbox', { name: 'Remote name', exact: true }).fill('Another remote name');
  await incoming(page, 'Incoming Settings update');
  await conflict(page).getByRole('button', { name: /Utiliser la valeur distante/ }).click();
  await expect(page.locator('#companyName')).toHaveValue('Another remote name');
  await expect(conflict(page)).toHaveCount(0); await expect(dirty(page)).toHaveCount(0);
  await page.locator('#companyName').fill('Explicitly saved local version');
  await page.getByRole('textbox', { name: 'Remote name', exact: true }).fill('Third remote name');
  await incoming(page, 'Incoming Settings update');
  await expect(conflict(page)).toBeVisible();
  await save(page).click();
  await expect(page.getByTestId('saved-cabinet')).toContainText('Explicitly saved local version');
  await expect(dirty(page)).toHaveCount(0); await expect(conflict(page)).toHaveCount(0);
});

test('Settings draft: switching cabinet initializes its saved values without carrying the old draft', async ({ page }) => {
  await page.locator('#companyName').fill('Unsaved first cabinet');
  await page.locator('#ice').fill('111111111111111');
  await incoming(page, 'Switch cabinet');
  await expect(page.locator('#companyName')).toHaveValue('Cabinet Atlas');
  await expect(page.locator('#ice')).toHaveValue('009876543000021');
  await expect(dirty(page)).toHaveCount(0); await expect(conflict(page)).toHaveCount(0);
});

test('Settings draft: successful save clears dirty flags and restores full live hydration', async ({ page }) => {
  await page.locator('#companyName').fill('Syndic Al Manar Updated');
  await save(page).click();
  await expect(page.getByTestId('saved-cabinet')).toContainText('Syndic Al Manar Updated');
  await expect(dirty(page)).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Remote name', exact: true }).fill('Name after successful save');
  await incoming(page, 'Incoming Settings update');
  await expect(page.locator('#companyName')).toHaveValue('Name after successful save');
  await expect(conflict(page)).toHaveCount(0);
});

test('Settings draft: pending saves preserve their draft and accept their own live acknowledgement', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Defer save' }).check();
  await page.locator('#companyName').fill('Submitted cabinet name');
  await save(page).click(); await expect(save(page)).toBeDisabled();
  await expect(page.locator('#companyName')).toBeDisabled();
  await incoming(page, 'Unrelated live update');
  await expect(page.locator('#companyName')).toHaveValue('Submitted cabinet name');
  await page.getByRole('button', { name: 'Complete save', exact: true }).click();
  await expect(save(page)).toBeEnabled();
  await expect(page.locator('#companyName')).toHaveValue('Submitted cabinet name');
  await expect(dirty(page)).toHaveCount(0); await expect(conflict(page)).toHaveCount(0);
  await page.locator('#companyName').fill('Newer unsaved cabinet name');
  await incoming(page, 'Unrelated live update');
  await expect(page.locator('#companyName')).toHaveValue('Newer unsaved cabinet name');
  await expect(dirty(page)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Defer save' }).uncheck();
  await save(page).click();
  await expect(page.getByTestId('saved-cabinet')).toContainText('Newer unsaved cabinet name');
  await expect(dirty(page)).toHaveCount(0);
});

test('Settings draft: failed save retains edits and dirty tracking across live updates', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Defer save' }).check();
  await page.locator('#companyName').fill('Retry this unsaved cabinet');
  await save(page).click(); await expect(save(page)).toBeDisabled();
  await incoming(page, 'Unrelated live update');
  await page.getByRole('button', { name: 'Reject save', exact: true }).click();
  await expect(save(page)).toBeEnabled();
  await expect(page.locator('#companyName')).toHaveValue('Retry this unsaved cabinet');
  await expect(dirty(page)).toBeVisible();
});

test('Settings draft: switching during save isolates late completion from the new cabinet', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Defer save' }).check();
  await page.locator('#companyName').fill('Old cabinet request');
  await save(page).click(); await expect(save(page)).toBeDisabled();
  await incoming(page, 'Switch cabinet');
  await expect(save(page)).toBeEnabled();
  await page.locator('#companyName').fill('New cabinet draft');
  await page.getByRole('button', { name: 'Complete save', exact: true }).click();
  await expect(page.getByTestId('saved-cabinet')).toContainText('Old cabinet request');
  await expect(page.locator('#companyName')).toHaveValue('New cabinet draft');
  await expect(dirty(page)).toBeVisible();
  await expect(page.getByText('Paramètres enregistrés avec succès.', { exact: true })).toHaveCount(0);
});

test('Settings draft: a remote value matching the draft clears dirty state without a conflict', async ({ page }) => {
  await page.locator('#companyName').fill('Same new value');
  await page.getByRole('textbox', { name: 'Remote name', exact: true }).fill('Same new value');
  await incoming(page, 'Incoming Settings update');
  await expect(page.locator('#companyName')).toHaveValue('Same new value');
  await expect(dirty(page)).toHaveCount(0); await expect(conflict(page)).toHaveCount(0);
});
