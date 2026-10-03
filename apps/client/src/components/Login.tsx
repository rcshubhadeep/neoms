import { useState, type FormEvent } from 'react';
import { supabase } from '../client';
import { explain, Mark } from './shared';
export function Login() {
  const [signUp, setSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = signUp
        ? await supabase.auth.signUp({ email, password, options: { data: { name } } })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signUp && !result.data.session) setError('Check your email to confirm your account.');
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="intro">
        <div className="brand">
          <Mark />
          neoms
        </div>
        <div>
          <p className="eyebrow">A LITTLE LESS CATCHING UP.</p>
          <h1>
            Good work
            <br />
            starts with
            <br />a shared space.
          </h1>
          <p className="lead">
            Conversations that stay with you.
            <br />
            An assistant that stays in the loop.
          </p>
        </div>
        <p className="intro-footer">PEOPLE + CONTEXT + POSSIBILITIES</p>
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <p className="eyebrow">YOUR TEAM, IN ONE PLACE</p>
          <h2>{signUp ? 'Make yourself at home.' : 'Welcome back.'}</h2>
          <p className="muted">
            {signUp
              ? 'Create an account to join your team.'
              : 'Sign in to pick up where you left off.'}
          </p>
          {signUp && (
            <label>
              Your name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signUp ? 'new-password' : 'current-password'}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            className="primary"
            aria-label={signUp ? 'Create account' : 'Sign in'}
            disabled={busy}
          >
            {busy ? 'One moment…' : signUp ? 'Create account' : 'Sign in'} <span>↗</span>
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setSignUp(!signUp);
              setError('');
            }}
          >
            {signUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
        </form>
        <p className="small muted">Private development preview · Mac + browser</p>
      </section>
    </main>
  );
}
