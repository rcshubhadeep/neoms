import { useState, type FormEvent } from 'react';
import { ArrowRight, GitPullRequest } from 'lucide-react';
import { supabase } from '../client';
import { explain } from './shared';
import { Avatar, Badge, Button, Callout, Field, SourceChip, Wordmark } from './ui';
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
    <main className="auth">
      <section className="auth__story">
        <Wordmark />
        <div className="auth__copy">
          <p className="t-label">A workspace for people and agents</p>
          <h1 className="t-display auth__headline">Where your team and its agents do the work.</h1>
          <p className="auth__lead">
            Conversations that keep their context, and agents that join them as teammates — not
            tools kept outside the room.
          </p>
          <div className="vignette card" aria-hidden="true">
            <div className="vignette__row">
              <Avatar name="Maya" size="sm" />
              <div>
                <strong>Maya</strong>
                Checkout is timing out for some EU customers.
              </div>
            </div>
            <div className="vignette__row">
              <Avatar name="Triage" kind="agent" size="sm" />
              <div>
                <strong>
                  Triage <Badge>Agent</Badge>
                </strong>
                On it. Reproduced in staging, fix is up for review.
                <SourceChip mark={<GitPullRequest />} id="#482" label="Retry payment intent" />
              </div>
            </div>
          </div>
        </div>
        <p className="auth__foot">Private development preview · Mac and browser</p>
      </section>
      <section className="auth__panel">
        <form className="auth__form" onSubmit={submit}>
          <h2 className="t-title">{signUp ? 'Create your account' : 'Welcome back'}</h2>
          <p>
            {signUp
              ? 'Join your team’s workspace in a minute.'
              : 'Sign in to pick up where you left off.'}
          </p>
          {signUp && (
            <Field
              label="Your name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="name"
            />
          )}
          <Field
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signUp ? 'new-password' : 'current-password'}
          />
          {error && <Callout tone="danger">{error}</Callout>}
          <Button
            variant="primary"
            size="lg"
            block
            aria-label={signUp ? 'Create account' : 'Sign in'}
            disabled={busy}
            trailing={<ArrowRight />}
          >
            {busy ? 'One moment…' : signUp ? 'Create account' : 'Sign in'}
          </Button>
          <button
            type="button"
            className="auth__switch"
            onClick={() => {
              setSignUp(!signUp);
              setError('');
            }}
          >
            {signUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
        </form>
      </section>
    </main>
  );
}
