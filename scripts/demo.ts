import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { pool } from '../packages/db/src/index.js';
import {
  identify,
  createWorkspace,
  sendMessage,
  invite,
  acceptInvite,
} from '../packages/domain/src/index.js';
if (process.env.SUPABASE_URL !== 'http://127.0.0.1:54321')
  throw new Error('Demo seeding is restricted to local Supabase');
const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const password = 'local-demo-password';
const { data, error } = await auth.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) throw error;
const people: { id: string; email: string }[] = [];
for (const name of ['Alice', 'Bob']) {
  const email = `${name.toLowerCase()}@neoms.test`;
  let user = data.users.find((u) => u.email === email);
  if (!user) {
    const result = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (result.error) throw result.error;
    user = result.data.user;
  }
  people.push({ id: (await identify(user.id, name)).id, email });
}
let workspace = (
  await pool.query(
    "select w.id from workspaces w join workspace_members wm on wm.workspace_id=w.id where wm.participant_id=$1 and w.name='Neoms demo'",
    [people[0].id],
  )
).rows[0];
if (!workspace) {
  workspace = await createWorkspace(people[0].id, 'Neoms demo');
  await acceptInvite(people[1].id, (await invite(people[0].id, workspace.id)).token);
  const conversation = (
    await pool.query('select id from conversations where workspace_id=$1', [workspace.id])
  ).rows[0].id;
  await sendMessage(
    people[0].id,
    conversation,
    randomUUID(),
    'Let’s use this space to plan our first pilot. The goal is reliable conversations across Mac and browser.',
  );
  await sendMessage(
    people[1].id,
    conversation,
    randomUUID(),
    'I’ll prepare the onboarding notes. Let’s review the invitation flow and reconnect behavior before we invite a team.',
  );
  await sendMessage(
    people[0].id,
    conversation,
    randomUUID(),
    'Agreed. Decision: finish the reliability checks first, then start with two pilot teams.',
  );
}
console.log('Local demo ready: alice@neoms.test and bob@neoms.test; password: local-demo-password');
await pool.end();
