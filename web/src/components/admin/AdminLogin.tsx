import { useState, type FormEvent } from 'react';
import { setAdminCreds } from '../../adminAuth.ts';

/**
 * Hardcoded-cred admin gate (plan §4.2). Credentials are verified against the
 * server before access is granted: we hit the admin-guarded invoices route with
 * a body that intentionally fails validation. Because `adminGuard` runs before
 * body validation, wrong credentials return 401 (rejected here) while correct
 * credentials return 400 (guard passed, no invoice created) — so any non-401
 * response confirms the credentials are valid. Placeholder for real auth.
 */
export function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError(null);

    const authHeader = `Basic ${btoa(`${user.trim()}:${pass}`)}`;
    try {
      // Empty body fails the route's schema, so a valid guard yields 400 (not a
      // created invoice); an invalid guard yields 401.
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({}),
      });

      if (res.status === 401) {
        setError('Invalid credentials. Please try again.');
        return;
      }

      // Any non-401 means the guard accepted the credentials.
      setAdminCreds(user.trim(), pass);
      onLogin();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="card">
      <h2>Admin sign in</h2>
      <p className="muted">Enter the operator credentials to access admin tools.</p>
      <form onSubmit={onSubmit} noValidate>
        <label>
          Username
          <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={verifying}>
          {verifying ? 'Verifying…' : 'Sign in'}
        </button>
      </form>
      {error && <div className="result error">{error}</div>}
    </div>
  );
}
