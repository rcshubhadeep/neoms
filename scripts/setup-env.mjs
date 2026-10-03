import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const raw = execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const info = JSON.parse(raw);
const existing = existsSync('.env')
  ? readFileSync('.env', 'utf8')
  : readFileSync('.env.example', 'utf8');
const values = {
  SUPABASE_URL: info.API_URL,
  VITE_SUPABASE_URL: info.API_URL,
  SUPABASE_PUBLISHABLE_KEY: info.PUBLISHABLE_KEY || info.ANON_KEY,
  VITE_SUPABASE_PUBLISHABLE_KEY: info.PUBLISHABLE_KEY || info.ANON_KEY,
  SUPABASE_SECRET_KEY: info.SECRET_KEY || info.SERVICE_ROLE_KEY,
  DATABASE_URL: info.DB_URL,
};
let output = existing;
for (const [key, value] of Object.entries(values)) {
  if (!value) throw new Error(`Missing local setting: ${key}`);
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  output = re.test(output) ? output.replace(re, line) : `${output}\n${line}\n`;
}
const installedKey = output.match(/^LLM_ENCRYPTION_KEY=(.*)$/m)?.[1].trim();
if (installedKey && !/^[0-9a-f]{64}$/i.test(installedKey)) {
  throw new Error(
    'Existing LLM_ENCRYPTION_KEY is invalid; correct it explicitly rather than rotating it automatically',
  );
}
if (!installedKey) {
  const line = `LLM_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`;
  output = /^LLM_ENCRYPTION_KEY=.*$/m.test(output)
    ? output.replace(/^LLM_ENCRYPTION_KEY=.*$/m, line)
    : `${output}\n${line}\n`;
}
writeFileSync('.env', output, { mode: 0o600 });
console.log('Local settings written to .env (credentials omitted).');
