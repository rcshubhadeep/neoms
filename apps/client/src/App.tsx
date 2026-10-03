import { lazy, Suspense, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './client';
import { Mark } from './components/ui';
import { Login } from './components/Login';
import { WorkspaceApp } from './components/WorkspaceApp';
const DesignSystem = lazy(() =>
  import('./components/DesignSystem').then((m) => ({ default: m.DesignSystem })),
);
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const onHash = () => setRoute(location.hash);
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (route === '#/design')
    return (
      <Suspense>
        <DesignSystem />
      </Suspense>
    );
  if (loading)
    return (
      <main className="boot">
        <Mark size={28} />
        <p>Opening your workspace…</p>
      </main>
    );
  return session ? <WorkspaceApp key={session.user.id} session={session} /> : <Login />;
}
