import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  recordUsage,
  fetchComponents,
  ApiTransportError,
  type Component,
  type UsageResponse,
} from '../../api.ts';
import { getLastTxn } from '../../lastTxn.ts';

interface FormState {
  txnRef: string;
  componentHandle: string;
  quantity: string;
  memo: string;
}

/** UC2 — Report Session Usage form (plan UC2). */
export function UsageForm() {
  const [form, setForm] = useState<FormState>(() => ({
    txnRef: getLastTxn()?.txnId ?? '',
    componentHandle: '',
    quantity: '',
    memo: '',
  }));
  const [components, setComponents] = useState<Component[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UsageResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchComponents()
      .then((list) => {
        if (cancelled) return;
        setComponents(list);
        setForm((f) => (f.componentHandle ? f : { ...f, componentHandle: list[0]?.handle ?? '' }));
      })
      .catch(() => {
        if (!cancelled) setComponents([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingComponents(false);
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

  const selectedUnit =
    components.find((c) => c.handle === form.componentHandle)?.unitName ?? 'unit';

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const res = await recordUsage({
        txnRef: form.txnRef.trim(),
        componentHandle: form.componentHandle,
        quantity: Number(form.quantity),
        ...(form.memo.trim() ? { memo: form.memo.trim() } : {}),
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
      <h2>Report Session Usage</h2>
      <p className="muted">
        Record consumption (e.g. consulting minutes or API calls) against the transaction&apos;s
        subscription. Maxio rates it and accrues it to the next invoice; updates post to the
        transaction&apos;s Slack channel.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <label>
          Transaction reference
          <input
            value={form.txnRef}
            onChange={(e) => update('txnRef', e.target.value)}
            placeholder="txnId from a booking"
            required
          />
          {fieldErrors.txnRef && <span className="err">{fieldErrors.txnRef}</span>}
        </label>

        <div className="row">
          <label>
            Component
            <select
              value={form.componentHandle}
              onChange={(e) => update('componentHandle', e.target.value)}
              disabled={loadingComponents}
              required
            >
              {loadingComponents && <option value="">Loading…</option>}
              {!loadingComponents && components.length === 0 && (
                <option value="">No components available</option>
              )}
              {components.map((c) => (
                <option key={c.handle} value={c.handle}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldErrors.componentHandle && (
              <span className="err">{fieldErrors.componentHandle}</span>
            )}
          </label>

          <label>
            Quantity ({selectedUnit}s)
            <input
              type="number"
              min="0"
              step="any"
              value={form.quantity}
              onChange={(e) => update('quantity', e.target.value)}
              required
            />
            {fieldErrors.quantity && <span className="err">{fieldErrors.quantity}</span>}
          </label>
        </div>

        <label>
          Memo <span className="muted">(optional)</span>
          <input value={form.memo} onChange={(e) => update('memo', e.target.value)} />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Recording…' : 'Record Usage'}
        </button>
      </form>

      {transportError && <div className="result error">{transportError}</div>}
      {result && <UsageResult result={result} />}
    </div>
  );
}

function UsageResult({ result }: { result: UsageResponse }) {
  if (result.status === 'ok') {
    const u = result.usage;
    return (
      <div className="result success">
        <h3>✅ Usage recorded</h3>
        <dl>
          <div>
            <dt>Component</dt>
            <dd>{u.componentName}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>
              {u.quantity} {u.unitName}
              {u.quantity === 1 ? '' : 's'}
            </dd>
          </div>
          {u.periodTotal != null && (
            <div>
              <dt>Period total</dt>
              <dd>
                {u.periodTotal} {u.unitName}s
              </dd>
            </div>
          )}
          <div>
            <dt>Slack channel</dt>
            <dd>{result.channelName ? `#${result.channelName}` : 'not posted'}</dd>
          </div>
        </dl>
        <p className="muted">Accrues to the next invoice.</p>
      </div>
    );
  }

  if (result.status === 'maxio_failed') {
    return (
      <div className="result error">
        <h3>⚠️ Usage failed</h3>
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

  if (result.status === 'session_expired') {
    return (
      <div className="result error">
        <h3>Transaction not found</h3>
        <p>{result.message ?? 'Create a subscription (Book & Subscribe) first, then retry.'}</p>
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
