import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pool } from '../../packages/db/src/index.js';

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('narrow windows use a navigation drawer and a compact header', async ({ browser }) => {
  if (process.env.SUPABASE_URL !== 'http://127.0.0.1:54321')
    throw new Error('Local Supabase required');
  const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const suffix = randomUUID().slice(0, 8);
  const email = `responsive-${suffix}@example.test`;
  const password = 'test-password-482!';
  const created = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Robin' },
  });
  if (created.error) throw created.error;
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'New workspace' }).click();
    await page.getByLabel('Name', { exact: true }).fill(`Responsive ${suffix}`);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'New channel', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('design');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'design', exact: true })).toBeVisible();

    const channels = page.getByRole('navigation', { name: 'Channels' });
    const toggle = page.getByRole('button', { name: 'Open navigation' });
    await expect(toggle).toBeHidden();

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(toggle).toBeVisible();
    await expect(channels).toBeHidden();
    await expect(page.getByRole('button', { name: 'Members', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Catch me up', exact: true })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    await toggle.click();
    await expect(channels.getByRole('button', { name: 'design', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(channels).toBeHidden();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await channels.getByRole('button', { name: 'general', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    await expect(channels).toBeHidden();
    await expect(page).toHaveURL(/#\/w\/[^/]+\/c\/[^/]+$/);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    // Widening while the drawer is open restores the permanent sidebar.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(toggle).toBeHidden();
    await channels.getByRole('button', { name: 'design', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'design', exact: true })).toBeVisible();
    await expect(channels).toBeVisible();
  } finally {
    await context.close();
    await pool.query('delete from workspaces where name=$1', [`Responsive ${suffix}`]);
    await auth.auth.admin.deleteUser(created.data.user.id);
  }
});
