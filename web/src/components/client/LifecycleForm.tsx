import { useMemo, useState, type FormEvent } from 'react';
import {
  lifecycleAction,
  ApiTransportError,
  type LifecycleActionName,
  type CancelTypeName,
  type LifecycleResponse,
} from '../../api.ts';
import { getLastTxn } from '../../lastTxn.ts';

const ACTIONS: { id: LifecycleActionName; label: string }[] = [
  { id: 'pause', label: 'Pause (hold)' },
  { id: 'resume', label: 'Resume' },
  { id: 'cancel', label: 'Cancel' },
  { id: 'reactivate', label: 'Reactivate' },
];

/** UC4 — Lifecycle Control form: pause / resume / cancel / reactivate (plan UC4). */
export function LifecycleForm() {
  const [txnRef, setTxnRef] = useState(getLastTxn()?.txnId ?? '');
  const [action, setAction] = useState<LifecycleActionName>('pause');
  const [cancelType, setCancelType] = useState<CancelTypeName>('immediate');
  const [reasonCode, setReasonCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LifecycleResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (result?.status === 'invalid') {
      for (const issue of result.errors) map[issue.path] = issue.message;
    }
    return map;
  }, [result]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const res = await lifecycleAction({
        txnRef: txnRef.trim(),
        action,
        ...(action === 'cancel' ? { cancelType } : {}),
        ...(action === 'cancel' && reasonCode.trim() ? { reasonCode: reasonCode.trim() } : {}),
      });
      setResult(res);
    } catch (err) {
      setTransportError(err instanceof ApiTransportError ? err.message : 'Unexpected error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Manage Subscription</h2>
      <p className="muted">
        Pause, resume, cancel, or reactivate the transaction&apos;s subscription. The state
        transition is posted to the transaction&apos;s Slack channel.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <label>
          Transaction reference
          <input
            value={txnRef}
            onChange={(e) => setTxnRef(e.target.value)}
            placeholder="txnId from a booking"
            required
          />
          {fieldErrors.txnRef && <span className="err">{fieldErrors.txnRef}</span>}
        </label>

        <div className="row">
          <label>
            Action
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as LifecycleActionName)}
            >
              {ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          {action === 'cancel' && (
            <label>
              Cancel type
              <select
                value={cancelType}
                onChange={(e) => setCancelType(e.target.value as CancelTypeName)}
              >
                <option value="immediate">Immediate</option>
                <option value="end-of-period">End of period</option>
              </select>
            </label>
          )}
        </div>

        {action === 'cancel' && (
          <label>
            Reason code <span className="muted">(optional)</span>
            <input value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
          </label>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Working…' : `Apply: ${action}`}
        </button>
      </form>

      {transportError && <div className="result error">{transportError}</div>}
      {result && <LifecycleResult result={result} />}
    </div>
  );
}

function LifecycleResult({ result }: { result: LifecycleResponse }) {
  if (result.status === 'ok') {
    const l = result.lifecycle;
    return (
      <div className="result success">
        <h3>🚦 {l.previousState} → {l.newState}</h3>
        <dl>
          <div>
            <dt>Action</dt>
            <dd>
              {l.action}
              {l.cancelType ? ` (${l.cancelType})` : ''}
            </dd>
          </div>
          {l.effectiveAt && (
            <div>
              <dt>Effective</dt>
              <dd>{l.effectiveAt}</dd>
            </div>
          )}
          {l.reasonCode && (
            <div>
              <dt>Reason</dt>
              <dd>{l.reasonCode}</dd>
            </div>
          )}
          <div>
            <dt>Slack channel</dt>
            <dd>{result.channelName ? `#${result.channelName}` : 'not posted'}</dd>
          </div>
        </dl>
        {l.note && <p className="muted">{l.note}</p>}
      </div>
    );
  }

  if (result.status === 'maxio_failed') {
    return (
      <div className="result error">
        <h3>⚠️ Action failed</h3>
        <p>{result.error}</p>
        <p className="muted">
          The subscription may already be in a state that doesn&apos;t allow this action.
        </p>
      </div>
    );
  }

  if (result.status === 'session_expired') {
    return (
      <div className="result error">
        <h3>Transaction not found</h3>
        <p>{result.message ?? 'Create a subscription first, then retry.'}</p>
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
