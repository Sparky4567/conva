import { useState } from 'react';
import { authRequest, type CurrentUser } from './api';
import { Icon } from './Icons';

export function Auth({ onAuthenticated }: { onAuthenticated(user: CurrentUser): void }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (register && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { user } = await authRequest(`/api/auth/${register ? 'register' : 'login'}`, 'POST', { name, email, password });
      onAuthenticated(user);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <main className="auth-page">
    <section className="auth-story"><a className="auth-brand" href="/">skype</a><div><span className="intro-icon"><Icon name="chat" size={34}/></span><h1>Your people.<br/>A little closer.</h1><p>Big ideas, little updates, and familiar voices.<br/>Make room for the conversations that matter.</p></div><small>A little closer, wherever you are.</small></section>
    <section className="auth-panel"><form className="auth-form" onSubmit={submit}>
      <span className="modal-icon"><Icon name={register ? 'users' : 'chat'} size={26}/></span>
      <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
      <p>{register ? 'A new connection starts with a simple hello.' : 'Sign in to pick up the conversation.'}</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      {register && <label className="field">Your name<input required autoComplete="name" minLength={2} maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Alex Morgan" disabled={busy}/></label>}
      <label className="field">Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" disabled={busy}/></label>
      <label className="field">Password<input required type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={register ? 'At least 12 characters' : 'Your password'} disabled={busy}/></label>
      {register && <label className="field">Confirm password<input required type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy}/></label>}
      <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}<Icon name="chevron" size={17}/></button>
      <p className="auth-switch">{register ? 'Already have an account?' : 'New to Skype?'} <button type="button" disabled={busy} onClick={() => { setRegister(!register); setPassword(''); setConfirmation(''); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button></p>
    </form></section>
  </main>;
}
