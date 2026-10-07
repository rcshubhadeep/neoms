import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
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
  let providerStarted = false,
    providerAborted = false;
  const hangingProvider = createServer((req, res) => {
    req.resume();
    providerStarted = true;
    res.on('close', () => {
      providerAborted = true;
    });
  });
  try {
    hangingProvider.listen(0, '127.0.0.1');
    await once(hangingProvider, 'listening');
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
    const workspaceResponse = alice.waitForResponse(
      (response) =>
        response.url().endsWith('/v1/workspaces') && response.request().method() === 'POST',
    );
    await alice.getByRole('button', { name: 'Create', exact: true }).click();
    const workspaceId = (await (await workspaceResponse).json()).id;
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
    await alice
      .getByRole('dialog', { name: 'Delete message?' })
      .getByRole('button', { name: 'Delete', exact: true })
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
    await alice
      .locator('.message--private')
      .getByRole('button', { name: 'Inspect run', exact: true })
      .click();
    const details = alice.getByRole('dialog', { name: 'Run details', exact: true });
    await expect(details).toContainText('Only you can inspect this run.');
    await expect(details).toContainText('Agent version 1');
    await expect(details).toContainText('Attempt 1: completed');
    await expect(details).toContainText('validation');
    await expect(bob.getByRole('button', { name: /Inspect Scribe run/ })).toHaveCount(0);
    await expect(bob.getByRole('button', { name: 'Inspect run', exact: true })).toHaveCount(0);
    await alice.screenshot({
      path: 'test-results/run-details.png',
      fullPage: true,
      animations: 'disabled',
    });
    await alice.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await alice.getByRole('button', { name: 'Workspace settings', exact: true }).click();
    await alice.getByRole('button', { name: 'Agent limits', exact: true }).click();
    await alice.getByLabel('Maximum messages', { exact: true }).fill('1');
    await alice.getByRole('button', { name: 'Save agent limits', exact: true }).click();
    await expect(
      alice.getByRole('status').filter({ hasText: 'Agent limits saved.' }),
    ).toBeVisible();
    await alice.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await alice
      .getByRole('combobox', { name: 'Choose an agent' })
      .selectOption({ label: 'Planner' });
    await alice.getByRole('button', { name: 'Suggest actions', exact: true }).click();
    await expect(alice.getByRole('dialog', { name: 'Confirm limited coverage' })).toContainText(
      '1 of 2 messages',
    );
    await alice.getByRole('button', { name: 'Run with this coverage', exact: true }).click();
    await expect(alice.getByText(/Test provider — not an AI action plan/)).toBeVisible({
      timeout: 20000,
    });
    await expect(bob.getByText(/Test provider — not an AI action plan/)).toHaveCount(0);
    await expect(
      alice.locator('.message--agent').filter({ hasText: 'not an AI action plan' }),
    ).toContainText('Planner');
    await alice.screenshot({ path: 'test-results/private-agent-result.png', fullPage: true });
    await alice
      .locator('.message--private')
      .filter({ hasText: 'not an AI action plan' })
      .getByRole('button', { name: 'Post to conversation', exact: true })
      .click();
    await expect(bob.getByText(/Test provider — not an AI action plan/)).toBeVisible();
    await expect(bob.getByText(/Shared by Alice/)).toBeVisible();
    await expect(bob.getByText(/Covered 1 of 2 messages/)).toBeVisible();
    const login = await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    ).auth.signInWithPassword({ email: accounts[0].email, password });
    if (login.error) throw login.error;
    const configured = await fetch(`http://127.0.0.1:3001/v1/workspaces/${workspaceId}/llm`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${login.data.session!.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai-compatible',
        model: 'held-cancellation-test',
        apiKey: 'local-test-key',
        baseUrl: `http://127.0.0.1:${(hangingProvider.address() as AddressInfo).port}/v1`,
      }),
    });
    expect(configured.ok).toBe(true);
    await alice
      .getByRole('combobox', { name: 'Choose an agent' })
      .selectOption({ label: 'Scribe' });
    await alice.getByRole('button', { name: 'Catch me up', exact: true }).click();
    await alice.getByRole('button', { name: 'Run with this coverage', exact: true }).click();
    await expect.poll(() => providerStarted).toBe(true);
    await alice.getByRole('button', { name: 'Inspect Scribe run · running', exact: true }).click();
    const stoppingDetails = alice.getByRole('dialog', { name: 'Run details', exact: true });
    await expect(stoppingDetails).toContainText('generation');
    await stoppingDetails.getByRole('button', { name: 'Stop run', exact: true }).click();
    await expect(stoppingDetails).toContainText('Cancellation requested');
    await expect(stoppingDetails).toContainText('Execution authority has been revoked', {
      timeout: 10000,
    });
    await expect.poll(() => providerAborted).toBe(true);
    await expect(bob.getByRole('button', { name: /Inspect.*cancelled/ })).toHaveCount(0);
    await alice.getByRole('button', { name: 'Close dialog', exact: true }).click();
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
    hangingProvider.closeAllConnections();
    await new Promise<void>((resolve) => hangingProvider.close(() => resolve()));
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
