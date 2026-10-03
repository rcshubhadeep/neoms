import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

test('two people exchange, recover, summarize, and revoke access', async ({ browser }) => {
  const suffix = randomUUID().slice(0, 8);
  const password = 'test-password-482!';
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const accounts: { id: string; email: string; name: string }[] = [];
  for (const name of ['Alice', 'Bob']) {
    const email = `e2e-${name}-${suffix}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    accounts.push({ id: data.user.id, email, name });
  }
  const a = await browser.newContext();
  const b = await browser.newContext();
  const alice = await a.newPage();
  const bob = await b.newPage();
  try {
    for (const [page, account] of [
      [alice, accounts[0]],
      [bob, accounts[1]],
    ] as const) {
      await page.goto('/');
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('button', { name: 'New workspace' })).toBeVisible();
    }
    await alice.getByRole('button', { name: 'New workspace' }).click();
    await alice.getByLabel('Name', { exact: true }).fill(`Pilot ${suffix}`);
    await alice.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(alice.getByRole('heading', { level: 1, name: 'general' })).toBeVisible();
    await alice.getByRole('button', { name: 'Invite a teammate' }).click();
    const invite = alice.getByLabel('Invitation token');
    await expect(invite).not.toHaveValue('Creating invitation…');
    await expect(invite).toHaveValue(/^[a-f0-9]{64}$/);
    const token = await invite.inputValue();
    await alice.getByRole('button', { name: 'Close dialog' }).click();
    await bob.getByRole('button', { name: 'Join', exact: true }).click();
    await bob.getByLabel('Invitation token').fill(token);
    await bob.getByRole('button', { name: 'Join workspace', exact: true }).click();
    await expect(bob.getByRole('heading', { level: 1, name: 'general' })).toBeVisible();
    await alice
      .getByRole('textbox', { name: 'Message general', exact: true })
      .fill('Decision: ship the pilot on Friday.');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      bob.getByText('Decision: ship the pilot on Friday.', { exact: true }),
    ).toBeVisible();
    await b.setOffline(true);
    await alice
      .getByRole('button', {
        name: 'Edit message Decision: ship the pilot on Friday.',
        exact: true,
      })
      .click();
    await alice
      .getByRole('textbox', { name: 'Edit message', exact: true })
      .fill('Decision: ship the pilot on Monday.');
    await alice.getByRole('button', { name: 'Save changes', exact: true }).click();
    await alice
      .getByRole('textbox', { name: 'Message general', exact: true })
      .fill('Temporary message');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      alice.getByRole('button', { name: 'Delete message Temporary message', exact: true }),
    ).toBeVisible();
    await alice
      .getByRole('button', { name: 'Delete message Temporary message', exact: true })
      .click();
    await b.setOffline(false);
    await expect(
      bob.getByText('Decision: ship the pilot on Monday.', { exact: true }),
    ).toBeVisible();
    await expect(bob.getByText('Message deleted', { exact: true })).toBeVisible();
    await expect(bob.getByText('Decision: ship the pilot on Friday.', { exact: true })).toHaveCount(
      0,
    );
    await bob
      .getByRole('textbox', { name: 'Message general', exact: true })
      .fill('I will prepare the release notes.');
    await bob.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      alice.getByText('I will prepare the release notes.', { exact: true }),
    ).toBeVisible();
    await alice.getByRole('button', { name: 'Catch me up' }).click();
    await expect(alice.getByText(/Test provider — not an AI summary/)).toBeVisible({
      timeout: 20000,
    });
    await expect(alice.locator('.citations button')).toHaveCount(2);
    await alice.reload();
    await expect(alice.getByText(/Test provider — not an AI summary/)).toBeVisible();
    await alice.getByRole('button', { name: 'Create channel', exact: true }).click();
    await alice.getByLabel('Name', { exact: true }).fill('private-project');
    await alice.getByLabel('Private channel').check();
    await alice.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(alice.getByRole('heading', { level: 1, name: 'private-project' })).toBeVisible();
    await expect(
      bob.getByRole('button', { name: 'private-project (private)', exact: true }),
    ).toHaveCount(0);
    await alice.getByRole('button', { name: 'Members', exact: true }).click();
    const bobRow = alice.locator('.member-list>div').filter({ hasText: 'Bob' });
    await bobRow.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(bobRow.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await alice.getByRole('button', { name: 'Close dialog' }).click();
    await bob.getByRole('button', { name: 'private-project (private)', exact: true }).click();
    await expect(bob.getByRole('heading', { level: 1, name: 'private-project' })).toBeVisible();
    await alice
      .getByRole('textbox', { name: 'Message private-project', exact: true })
      .fill('Restricted project context');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.getByText('Restricted project context', { exact: true })).toBeVisible();
    await alice.getByRole('button', { name: 'Members', exact: true }).click();
    await alice
      .locator('.member-list>div')
      .filter({ hasText: 'Bob' })
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await alice.getByRole('button', { name: 'Close dialog' }).click();
    await expect(bob.getByText('Restricted project context', { exact: true })).toHaveCount(0);
    await expect(
      bob.getByRole('button', { name: 'private-project (private)', exact: true }),
    ).toHaveCount(0);
    await alice.screenshot({ path: 'test-results/workspace.png', fullPage: true });
  } finally {
    await a.close();
    await b.close();
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      for (const account of accounts) {
        await db.query(
          "delete from app.workspaces where id in(select workspace_id from app.workspace_members wm join app.participants p on p.id=wm.participant_id where p.auth_user_id=$1 and wm.role='owner')",
          [account.id],
        );
        await admin.auth.admin.deleteUser(account.id);
      }
    } finally {
      await db.end();
    }
  }
});

test('a new user can create an account through the interface', async ({ page }) => {
  const email = `signup-${randomUUID()}@example.test`;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
    await page.getByLabel('Your name', { exact: true }).fill('New teammate');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('test-password-482!');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New workspace', exact: true })).toBeVisible();
  } finally {
    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = data.users.find((u) => u.email === email);
    if (user) await admin.auth.admin.deleteUser(user.id);
  }
});
