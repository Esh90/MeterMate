import { useEffect, useState } from 'react';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; status: string }
  | { kind: 'error'; message: string };

/**
 * Phase 0 shell. Confirms the SPA renders and can reach the backend health
 * endpoint through the Vite proxy. Replaced by the role-switch shell in Phase 6.
 */
export function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { status: string };
      })
      .then((data) => {
        if (!cancelled) setHealth({ kind: 'ok', status: data.status });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHealth({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <h1>MeterMate</h1>
      <p>Maxio + Slack billing concierge — scaffold online.</p>
      <section
        style={{
          marginTop: '1rem',
          padding: '0.75rem 1rem',
          borderRadius: 8,
          border: '1px solid #ddd',
        }}
      >
        <strong>Backend health:</strong>{' '}
        {health.kind === 'loading' && <span>checking…</span>}
        {health.kind === 'ok' && <span style={{ color: 'green' }}>{health.status}</span>}
        {health.kind === 'error' && (
          <span style={{ color: 'crimson' }}>unreachable ({health.message})</span>
        )}
      </section>
    </main>
  );
}
