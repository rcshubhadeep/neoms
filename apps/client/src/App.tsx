import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './client';
import { Mark } from './components/shared';
import { Login } from './components/Login';
import { WorkspaceApp } from './components/WorkspaceApp';
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (loading)
    return (
      <main className="loading">
        <Mark />
        <p>Opening your workspace…</p>
      </main>
    );
  return session ? <WorkspaceApp key={session.user.id} session={session} /> : <Login />;
}
