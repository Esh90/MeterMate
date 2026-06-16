import { useEffect, useState } from 'react';
import { BookForm } from './components/client/BookForm.tsx';
import { UsageForm } from './components/client/UsageForm.tsx';
import { PlanChangeForm } from './components/client/PlanChangeForm.tsx';
import { LifecycleForm } from './components/client/LifecycleForm.tsx';
import { AdminLogin } from './components/admin/AdminLogin.tsx';
import { InvoiceForm } from './components/admin/InvoiceForm.tsx';
import { hasAdminCreds, clearAdminCreds } from './adminAuth.ts';

type Role = 'client' | 'admin';
type ClientTab = 'book' | 'usage' | 'plan' | 'lifecycle';

const CLIENT_TABS: { id: ClientTab; label: string }[] = [
  { id: 'book', label: 'Book & Subscribe' },
  { id: 'usage', label: 'Report Usage' },
  { id: 'plan', label: 'Change Plan' },
  { id: 'lifecycle', label: 'Manage Subscription' },
];

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; slackOk: boolean | null; maxioSite: string }
  | { kind: 'error' };

/**
 * Application shell (plan §4.2): a role switch (Client | Admin) plus a backend
 * health indicator. The Client role exposes the booking flow (UC1). Admin tools
 * (UC5/UC6) mount here as their backends land.
 */
export function App() {
  const [role, setRole] = useState<Role>('client');
  const [clientTab, setClientTab] = useState<ClientTab>('book');
  const [adminLoggedIn, setAdminLoggedIn] = useState<boolean>(hasAdminCreds());
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  function signOutAdmin() {
    clearAdminCreds();
    setAdminLoggedIn(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { slackOk: boolean | null; maxioSite: string };
      })
      .then((data) => {
        if (!cancelled) setHealth({ kind: 'ok', slackOk: data.slackOk, maxioSite: data.maxioSite });
      })
      .catch(() => {
        if (!cancelled) setHealth({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">📟</span>
          <div>
            <h1>MeterMate</h1>
            <span className="muted">Maxio + Slack billing concierge</span>
          </div>
        </div>
        <div className="roles" role="tablist" aria-label="Role">
          <button
            className={role === 'client' ? 'active' : ''}
            onClick={() => setRole('client')}
            role="tab"
            aria-selected={role === 'client'}
          >
            Client
          </button>
          <button
            className={role === 'admin' ? 'active' : ''}
            onClick={() => setRole('admin')}
            role="tab"
            aria-selected={role === 'admin'}
          >
            Admin
          </button>
        </div>
      </header>

      <div className="healthbar">
        {health.kind === 'loading' && <span className="muted">checking backend…</span>}
        {health.kind === 'error' && <span className="dot bad" />}
        {health.kind === 'ok' && (
          <>
            <span className="dot ok" /> backend ok · site <code>{health.maxioSite}</code> · Slack{' '}
            {health.slackOk == null ? 'checking' : health.slackOk ? 'connected' : 'unavailable'}
          </>
        )}
        {health.kind === 'error' && <span> backend unreachable</span>}
      </div>

      <main className="content">
        {role === 'client' ? (
          <>
            <nav className="subnav" aria-label="Client actions">
              {CLIENT_TABS.map((t) => (
                <button
                  key={t.id}
                  className={clientTab === t.id ? 'active' : ''}
                  onClick={() => setClientTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            {clientTab === 'book' && <BookForm />}
            {clientTab === 'usage' && <UsageForm />}
            {clientTab === 'plan' && <PlanChangeForm />}
            {clientTab === 'lifecycle' && <LifecycleForm />}
          </>
        ) : adminLoggedIn ? (
          <>
            <div className="adminbar">
              <span className="muted">Signed in as operator</span>
              <button className="ghost" onClick={signOutAdmin}>
                Sign out
              </button>
            </div>
            <InvoiceForm onUnauthorized={signOutAdmin} />
          </>
        ) : (
          <AdminLogin onLogin={() => setAdminLoggedIn(true)} />
        )}
      </main>
    </div>
  );
}
