import { useEffect, useState, type FormEvent } from 'react';
import {
  requestDigest,
  fetchConsultants,
  ApiTransportError,
  type Consultant,
  type DigestResponse,
} from '../../api.ts';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** UC6 — Billing Activity Digest panel (admin). Requires admin sign-in. */
export function ActivityPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [consultantId, setConsultantId] = useState('');
  const [windowDays, setWindowDays] = useState('30');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DigestResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchConsultants()
      .then((list) => {
        if (cancelled) return;
        setConsultants(list);
        setConsultantId((c) => c || list[0]?.id || '');
      })
      .catch(() => {
        if (!cancelled) setConsultants([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const res = await requestDigest({
        consultantId,
        windowDays: Number(windowDays) || 30,
      });
      setResult(res);
      if (res.status === 'unauthorized') onUnauthorized();
    } catch (err) {
      setTransportError(err instanceof ApiTransportError ? err.message : 'Unexpected error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Billing Activity Digest</h2>
      <p className="muted">
        Build a per-consultant summary from live Maxio data and post it to the digest Slack channel.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div className="row">
          <label>
            Consultant
            <select value={consultantId} onChange={(e) => setConsultantId(e.target.value)} required>
              {consultants.length === 0 && <option value="">No consultants</option>}
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Window (days)
            <input
              type="number"
              min="1"
              max="365"
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
            />
          </label>
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Building…' : 'Build digest'}
        </button>
      </form>

      {transportError && <div className="result error">{transportError}</div>}
      {result && <DigestResult result={result} />}
    </div>
  );
}

function DigestResult({ result }: { result: DigestResponse }) {
  if (result.status === 'ok') {
    const d = result.digest;
    return (
      <div className="result success">
        <h3>📈 Billing digest — {d.consultantName}</h3>
        <p className="muted">Last {d.windowDays} days · {d.subscriptionsConsidered} subscription(s) considered</p>
        <dl>
          <div>
            <dt>Active subscriptions</dt>
            <dd>{d.activeCount}</dd>
          </div>
          <div>
            <dt>MRR</dt>
            <dd>{money(d.mrrInCents)}</dd>
          </div>
          <div>
            <dt>New signups</dt>
            <dd>{d.newSignups}</dd>
          </div>
          <div>
            <dt>Churn</dt>
            <dd>{d.churn}</dd>
          </div>
          <div>
            <dt>Overdue invoices</dt>
            <dd>{d.overdueInvoices}</dd>
          </div>
          <div>
            <dt>Recent events</dt>
            <dd>{d.recentEvents}</dd>
          </div>
        </dl>
        <p className="muted">
          {result.posted ? `Posted to the digest channel.` : 'Not posted (no digest channel configured).'}{' '}
          {d.caveat}
        </p>
      </div>
    );
  }

  if (result.status === 'unauthorized') {
    return (
      <div className="result error">
        <h3>Admin credentials rejected</h3>
        <p>Please sign in again with valid operator credentials.</p>
      </div>
    );
  }

  if (result.status === 'maxio_failed') {
    return (
      <div className="result error">
        <h3>⚠️ Digest failed</h3>
        <p>{result.error}</p>
      </div>
    );
  }

  if (result.status === 'invalid') {
    return (
      <div className="result error">
        <h3>Please fix the highlighted fields.</h3>
      </div>
    );
  }

  return (
    <div className="result error">
      <h3>Something went wrong</h3>
      <p>{result.message}</p>
    </div>
  );
}
