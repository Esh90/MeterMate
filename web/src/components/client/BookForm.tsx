import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  book,
  fetchConsultants,
  ApiTransportError,
  type BookResponse,
  type Consultant,
} from '../../api.ts';
import { PLAN_OPTIONS } from '../../constants.ts';

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  consultantId: string;
  productHandle: string;
  collectionMethod: 'automatic' | 'remittance';
  couponCode: string;
}

const INITIAL: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  consultantId: '',
  productHandle: PLAN_OPTIONS[0]?.handle ?? 'basic',
  collectionMethod: 'remittance',
  couponCode: '',
};

function money(cents: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : '';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** UC1 — Book & Subscribe form (plan UC1). */
export function BookForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loadingConsultants, setLoadingConsultants] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchConsultants()
      .then((list) => {
        if (cancelled) return;
        setConsultants(list);
        setForm((f) => (f.consultantId ? f : { ...f, consultantId: list[0]?.id ?? '' }));
      })
      .catch(() => {
        if (!cancelled) setConsultants([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingConsultants(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (result?.status === 'invalid') {
      for (const issue of result.errors) map[issue.path] = issue.message;
    }
    return map;
  }, [result]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const res = await book({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        consultantId: form.consultantId,
        productHandle: form.productHandle,
        collectionMethod: form.collectionMethod,
        ...(form.couponCode.trim() ? { couponCode: form.couponCode.trim() } : {}),
      });
      setResult(res);
    } catch (err) {
      setTransportError(
        err instanceof ApiTransportError ? err.message : 'Unexpected error contacting the server.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Book &amp; Subscribe</h2>
      <p className="muted">
        Book a session with a consultant and enrol on a plan. A private Slack channel is created
        for this consultant↔client transaction.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div className="row">
          <label>
            First name
            <input
              value={form.firstName}
              onChange={(e) => update('firstName', e.target.value)}
              required
            />
            {fieldErrors.firstName && <span className="err">{fieldErrors.firstName}</span>}
          </label>
          <label>
            Last name
            <input
              value={form.lastName}
              onChange={(e) => update('lastName', e.target.value)}
              required
            />
            {fieldErrors.lastName && <span className="err">{fieldErrors.lastName}</span>}
          </label>
        </div>

        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
          />
          {fieldErrors.email && <span className="err">{fieldErrors.email}</span>}
        </label>

        <div className="row">
          <label>
            Consultant
            <select
              value={form.consultantId}
              onChange={(e) => update('consultantId', e.target.value)}
              disabled={loadingConsultants}
              required
            >
              {loadingConsultants && <option value="">Loading…</option>}
              {!loadingConsultants && consultants.length === 0 && (
                <option value="">No consultants available</option>
              )}
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldErrors.consultantId && <span className="err">{fieldErrors.consultantId}</span>}
          </label>

          <label>
            Plan
            <select
              value={form.productHandle}
              onChange={(e) => update('productHandle', e.target.value)}
              required
            >
              {PLAN_OPTIONS.map((p) => (
                <option key={p.handle} value={p.handle}>
                  {p.label}
                </option>
              ))}
            </select>
            {fieldErrors.productHandle && <span className="err">{fieldErrors.productHandle}</span>}
          </label>
        </div>

        <div className="row">
          <label>
            Payment collection
            <select
              value={form.collectionMethod}
              onChange={(e) =>
                update('collectionMethod', e.target.value as FormState['collectionMethod'])
              }
            >
              <option value="remittance">Remittance (invoice)</option>
              <option value="automatic">Automatic (card on file)</option>
            </select>
          </label>
          <label>
            Coupon code <span className="muted">(optional)</span>
            <input
              value={form.couponCode}
              onChange={(e) => update('couponCode', e.target.value)}
            />
          </label>
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Booking…' : 'Book & Subscribe'}
        </button>
      </form>

      {transportError && <div className="result error">{transportError}</div>}
      {result && <BookResult result={result} />}
    </div>
  );
}

function BookResult({ result }: { result: BookResponse }) {
  if (result.status === 'ok') {
    const s = result.subscription;
    return (
      <div className="result success">
        <h3>🎉 Subscription active{result.idempotent ? ' (already created)' : ''}</h3>
        <dl>
          <div>
            <dt>Plan</dt>
            <dd>
              {s.productName} (<code>{s.productHandle}</code>)
            </dd>
          </div>
          <div>
            <dt>MRR</dt>
            <dd>
              {money(s.mrrInCents, s.currency)} / month
            </dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{s.state}</dd>
          </div>
          <div>
            <dt>Subscription ID</dt>
            <dd>{s.subscriptionId}</dd>
          </div>
          {s.nextAssessmentAt && (
            <div>
              <dt>Next bill</dt>
              <dd>{s.nextAssessmentAt}</dd>
            </div>
          )}
          <div>
            <dt>Slack channel</dt>
            <dd>{result.channelName ? `#${result.channelName}` : 'not created'}</dd>
          </div>
        </dl>
        {result.channel && result.channel.notes.length > 0 && (
          <ul className="notes">
            {result.channel.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (result.status === 'maxio_failed') {
    return (
      <div className="result error">
        <h3>⚠️ Booking failed</h3>
        <p>{result.error}</p>
        {result.channelName && (
          <p className="muted">Channel #{result.channelName} received a failure notice.</p>
        )}
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

  if (result.status === 'session_expired') {
    return (
      <div className="result error">
        <h3>Session expired</h3>
        <p>Please reload and start the booking again.</p>
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
