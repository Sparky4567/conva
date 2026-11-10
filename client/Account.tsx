import { useState } from 'react';
import { authRequest, type CurrentUser } from './api';
import { Icon } from './Icons';

export function Account({ user, onSignedOut }: { user: CurrentUser; onSignedOut(): void }) {
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    setBusy(true); setError('');
    try { await authRequest('/api/auth/logout', 'POST'); onSignedOut(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true); setError('');
    try { await authRequest('/api/account', 'DELETE', { password }); onSignedOut(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <h2>{deleting ? 'Delete your account?' : 'Your account'}</h2>
    {error && <div className="form-error" role="alert">{error}</div>}
    {deleting ? <form onSubmit={remove}>
      <p>This permanently deletes your account, all your sessions, messages you sent, and your direct conversations. You will be removed from groups. This cannot be undone.</p>
      <label className="field">Confirm your password<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label>
      <label className="delete-confirm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy}/>I understand my account and messages will be permanently deleted.</label>
      <button className="danger full" disabled={busy || !confirmed || !password}>{busy ? 'Deleting…' : 'Permanently delete account'}</button>
      <button type="button" className="secondary full" disabled={busy} onClick={() => { setDeleting(false); setPassword(''); setError(''); }}>Keep my account</button>
    </form> : <>
      <p>You’re signed in as <strong>{user.name}</strong>.</p>
      <dl className="account-info"><dt>Email address</dt><dd>{user.email}</dd></dl>
      <button className="primary full" onClick={logout} disabled={busy}><Icon name="logout" size={17}/>{busy ? 'Signing out…' : 'Sign out'}</button>
      <div className="danger-zone"><h3>Delete account</h3><p>Permanently remove your account and messages.</p><button className="danger-outline" disabled={busy} onClick={() => setDeleting(true)}>Delete my account</button></div>
    </>}
  </>;
}
