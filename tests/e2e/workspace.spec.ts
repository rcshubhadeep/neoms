import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pool } from '../../packages/db/src/index.js';

test('workspace essentials: channels, DMs, admin roles, BYOK, invites, usage and disable/re-enable', async ({
  browser,
}) => {
  test.setTimeout(120000);
  if (process.env.SUPABASE_URL !== 'http://127.0.0.1:54321')
    throw new Error('Local Supabase required');
  const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const accounts: { id: string; email: string; name: string }[] = [];
  const suffix = randomUUID().slice(0, 8),
    password = 'test-password-482!';
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [alice, bob] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (const [index, name] of ['Alice', 'Bob'].entries()) {
      const email = `essentials-${name}-${suffix}@example.test`;
      const result = await auth.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (result.error) throw result.error;
      accounts.push({ id: result.data.user.id, email, name });
      const page = index === 0 ? alice : bob;
      await page.goto('/');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('button', { name: 'New workspace' })).toBeVisible();
    }
    await alice.getByRole('button', { name: 'New workspace' }).click();
    await alice.getByLabel('Name', { exact: true }).fill(`Essentials ${suffix}`);
    await alice.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(alice.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    await alice.getByRole('button', { name: 'Invite a teammate' }).click();
    await expect(alice.getByLabel('Invitation token')).toHaveValue(/^[a-f0-9]{64}$/);
    const token = await alice.getByLabel('Invitation token').inputValue();
    await alice.getByRole('button', { name: 'Close dialog' }).click();
    await bob.getByRole('button', { name: 'Join', exact: true }).click();
    await bob.getByLabel('Invitation token').fill(token);
    await bob.getByRole('button', { name: 'Join workspace' }).click();
    await expect(
      bob
        .getByRole('navigation', { name: 'Workspace members' })
        .getByRole('button', { name: 'Message Alice' }),
    ).toBeVisible();
    await bob.getByRole('button', { name: 'New channel', exact: true }).click();
    await bob.getByLabel('Name', { exact: true }).fill('engineering');
    await bob.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(bob.getByRole('heading', { name: 'engineering', exact: true })).toBeVisible();
    await expect(
      alice
        .getByRole('navigation', { name: 'Channels' })
        .getByRole('button', { name: 'engineering', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await bob
      .getByRole('textbox', { name: 'Message engineering', exact: true })
      .fill('Unread channel update');
    await bob.getByRole('button', { name: 'Send message', exact: true }).click();
    const unreadChannel = alice
      .getByRole('navigation', { name: 'Channels' })
      .getByRole('button', { name: 'engineering', exact: true });
    await expect(unreadChannel).toHaveAttribute('data-unread', 'true', { timeout: 10000 });
    await expect(unreadChannel).toHaveCSS('font-weight', '700');
    await alice.reload();
    await expect(unreadChannel).toHaveAttribute('data-unread', 'true', { timeout: 10000 });
    await alice.bringToFront();
    await unreadChannel.click();
    await expect(alice.getByText('Unread channel update', { exact: true })).toBeVisible();
    await expect(unreadChannel).not.toHaveAttribute('data-unread', 'true');
    await bob.getByRole('button', { name: 'Message Alice' }).click();
    await expect(bob.getByRole('heading', { name: 'Alice', exact: true })).toBeVisible();
    await bob
      .getByRole('textbox', { name: 'Message Alice', exact: true })
      .fill('A private note for Alice');
    await bob.getByRole('button', { name: 'Send message', exact: true }).click();
    const unreadDm = alice
      .getByRole('navigation', { name: 'Direct messages' })
      .getByRole('button', { name: 'Bob', exact: true });
    await expect(unreadDm).toHaveAttribute('data-unread', 'true', { timeout: 10000 });
    await expect(unreadDm).toHaveCSS('font-weight', '700');
    await alice.screenshot({ path: test.info().outputPath('unread-sidebar.png') });
    await alice.reload();
    await expect(unreadDm).toHaveAttribute('data-unread', 'true', { timeout: 10000 });
    await alice.bringToFront();
    await alice.getByRole('button', { name: 'Message Bob' }).click();
    await expect(alice.getByText('A private note for Alice', { exact: true })).toBeVisible();
    await expect(unreadDm).not.toHaveAttribute('data-unread', 'true');
    await expect(alice.getByRole('button', { name: 'Catch me up' })).toHaveCount(0);
    await alice.screenshot({ path: '/tmp/neoms-workspace-dm.png' });
    await alice.getByRole('button', { name: 'Workspace settings', exact: true }).click();
    await alice.getByLabel('Role for Bob').selectOption('admin');
    await expect(
      alice.getByRole('status').filter({ hasText: 'Member role updated.' }),
    ).toBeVisible();
    await expect(bob.getByRole('button', { name: 'Workspace settings', exact: true })).toBeVisible({
      timeout: 10000,
    });
    await bob.getByRole('button', { name: 'Workspace settings', exact: true }).click();
    await expect(bob.getByLabel('Role for Alice')).toHaveCount(0);
    await expect(bob.getByRole('button', { name: 'Disable Alice', exact: true })).toBeDisabled();
    await alice.getByRole('button', { name: 'LLM configuration', exact: true }).click();
    await alice.getByLabel('Provider', { exact: true }).selectOption('anthropic');
    await alice.getByLabel('Model ID').fill('controlled-browser-test');
    await alice.getByLabel('API key', { exact: true }).fill('not-a-real-browser-key');
    await alice.getByRole('button', { name: 'Save model settings' }).click();
    await expect(alice.getByText('Key configured', { exact: true })).toBeVisible();
    await expect(alice.getByLabel('Replace API key (optional)')).toHaveValue('');
    await alice.screenshot({ path: '/tmp/neoms-admin-light.png' });
    await alice.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(alice.locator('.nav-item[aria-current="page"] svg')).toHaveCSS(
      'color',
      'rgba(250, 250, 247, 0.78)',
    );
    await alice.screenshot({ path: '/tmp/neoms-admin-dark.png' });
    await alice.emulateMedia({ colorScheme: 'light' });
    await alice.getByRole('button', { name: 'Remove key', exact: true }).click();
    await expect(alice.getByText('No key stored', { exact: true })).toBeVisible();
    await alice.getByLabel('Provider', { exact: true }).selectOption('test');
    await alice.getByRole('button', { name: 'Save model settings' }).click();
    await expect(
      alice.getByRole('status').filter({ hasText: 'Workspace model settings saved.' }),
    ).toBeVisible();
    await alice.getByRole('button', { name: 'Invitations', exact: true }).click();
    await alice.getByRole('button', { name: 'Create invite token' }).click();
    await expect(alice.getByLabel('New invitation token')).toHaveValue(/^[a-f0-9]{64}$/);
    await alice.getByRole('button', { name: /^Revoke / }).click();
    await expect(alice.getByRole('cell', { name: 'Revoked', exact: true })).toBeVisible();
    await alice.getByRole('button', { name: 'Usage', exact: true }).click();
    await expect(alice.getByRole('heading', { name: 'Member token usage' })).toBeVisible();
    await expect(alice.getByRole('rowheader', { name: 'Bob', exact: true })).toBeVisible();
    await alice.getByRole('button', { name: 'Members', exact: true }).click();
    await alice.getByLabel('Role for Bob').selectOption('member');
    await expect(bob.getByRole('button', { name: 'Workspace settings', exact: true })).toHaveCount(
      0,
      { timeout: 10000 },
    );
    await alice.getByRole('button', { name: 'Disable Bob', exact: true }).click();
    await expect(bob.getByRole('navigation', { name: 'Direct messages' })).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(bob.getByText('A private note for Alice', { exact: true })).toHaveCount(0);
    await alice.getByRole('button', { name: 'Enable Bob', exact: true }).click();
    await expect(bob.getByRole('button', { name: 'Message Alice' })).toBeVisible({
      timeout: 10000,
    });
    await alice.getByRole('button', { name: 'Back to conversations' }).click();
    await alice.getByRole('button', { name: 'Create channel', exact: true }).click();
    await expect(alice.getByLabel('Name', { exact: true })).toBeFocused();
    await alice.getByRole('button', { name: 'Create', exact: true }).focus();
    await alice.keyboard.press('Tab');
    await expect(alice.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await alice.keyboard.press('Escape');
    await expect(alice.getByRole('button', { name: 'Create channel', exact: true })).toBeFocused();
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await pool.query('delete from workspaces where name=$1', [`Essentials ${suffix}`]);
    for (const account of accounts) await auth.auth.admin.deleteUser(account.id);
  }
});
