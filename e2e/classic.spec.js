const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('classic game reveals safely, flags, and restarts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#board .cell')).toHaveCount(81);
  const first = page.locator('#board .cell').first();
  await first.click({ button: 'right' });
  await expect(first).toHaveClass(/flagged/);
  await first.click({ button: 'right' });
  await expect(first).toHaveClass(/question/);
  await first.click({ button: 'right' });
  await first.click();
  await expect(first).toHaveClass(/revealed/);
  await expect(page.locator('#board .exploded')).toHaveCount(0);
  await page.locator('#smiley').click();
  await expect(page.locator('#board .revealed')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('classic difficulty and custom dialog still work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  await page.locator('[data-action="intermediate"]').click();
  await expect(page.locator('#board .cell')).toHaveCount(256);
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  await page.locator('[data-action="custom"]').click();
  await expect(page.locator('#dialog-custom')).toBeVisible();
  await page.locator('#custom-width').fill('10');
  await page.locator('#custom-height').fill('8');
  await page.locator('#custom-mines').fill('12');
  await page.locator('#custom-ok').click();
  await expect(page.locator('#board .cell')).toHaveCount(80);
});

test('app works directly from index.html without a server', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
  await expect(page.locator('#board .cell')).toHaveCount(81);
  await page.locator('#board .cell').first().click();
  await expect(page.locator('#board .cell').first()).toHaveClass(/revealed/);
});
