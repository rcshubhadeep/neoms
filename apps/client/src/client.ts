import { createClient } from '@supabase/supabase-js';
import { createApi } from '../../../packages/contracts/src/index';
export const base = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'unconfigured',
);
export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in required');
  return data.session.access_token;
}
export const api = createApi(base, accessToken);
export type Pending = {
  requestId: string;
  body: string;
  status: 'sending' | 'failed';
  error?: string;
};
export function cacheRead<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
export function cacheWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Cache is optional; server persistence remains authoritative. */
  }
}
export function purgeConversation(user: string, conversation: string) {
  localStorage.removeItem(`messages:${user}:${conversation}`);
  localStorage.removeItem(`pending:${user}:${conversation}`);
  localStorage.removeItem(`draft:${user}:${conversation}`);
}
export function purgeUser(user: string) {
  for (const key of Object.keys(localStorage))
    if (
      key.startsWith(`messages:${user}:`) ||
      key.startsWith(`pending:${user}:`) ||
      key.startsWith(`draft:${user}:`)
    )
      localStorage.removeItem(key);
}
