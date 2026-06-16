import { useMemo, useState, type FormEvent } from 'react';
import {
  previewPlanChange,
  applyPlanChange,
  ApiTransportError,
  type PlanPreviewResponse,
  type PlanChangeResponse,
} from '../../api.ts';
import { PLAN_OPTIONS } from '../../constants.ts';
import { getLastTxn } from '../../lastTxn.ts';

type Timing = 'prorate' | 'at-renewal';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** UC3 — Plan Change with proration preview (plan UC3). Preview, then confirm. */
export function PlanChangeForm() {
  const [txnRef, setTxnRef] = useState(getLastTxn()?.txnId ?? '');
  const [targetHandle, setTargetHandle] = useState(PLAN_OPTIONS[0]?.handle ?? 'basic');
  const [timing, setTiming] = useState<Timing>('prorate');

  const [preview, setPreview] = useState<PlanPreviewResponse | null>(null);
  const [applied, setApplied] = useState<PlanChangeResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    const src = applied ?? preview;
    if (src?.status === 'invalid') {
      for (const issue of src.errors) map[issue.path] = issue.message;
    }
    return map;
  }, [preview, applied]);

  // Any change to the inputs invalidates a stale preview/result.
  function resetResults() {
    setPreview(null);
    setApplied(null);
    setTransportError(null);
  }

  async function onPreview(e: FormEvent) {
    e.preventDefault();
    setPreviewing(true);
    setApplied(null);
    setTransportError(null);
    try {
      setPreview(await previewPlanChange({ txnRef: txnRef.trim(), targetHandle }));
    } catch (err) {
      setTransportError(err instanceof ApiTransportError ? err.message : 'Unexpected error.');
    } finally {
      setPreviewing(false);
    }
  }

  async function onApply() {
    setApplying(true);
    setTransportError(null);
    try {
      setApplied(await applyPlanChange({ txnRef: txnRef.trim(), targetHandle, timing }));
    } catch (err) {
      setTransportError(err instanceof ApiTransportError ? err.message : 'Unexpected error.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="card">
      <h2>Change Plan</h2>
      <p className="muted">
        Preview the prorated cost of moving to another plan, then confirm. &quot;Prorate now&quot;
        applies immediately with a prorated charge; &quot;At renewal&quot; schedules a non-prorated
        change for the next billing period.
      </p>

      <form onSubmit={onPreview} noValidate>
        <label>
          Transaction reference
          <input
            value={txnRef}
            onChange={(e) => {
              setTxnRef(e.target.value);
              resetResults();
            }}
            placeholder="txnId from a booking"
            required
          />
          {fieldErrors.txnRef && <span className="err">{fieldErrors.txnRef}</span>}
        </label>

        <div className="row">
          <label>
            Target plan
            <select
              value={targetHandle}
              onChange={(e) => {
                setTargetHandle(e.target.value);
                resetResults();
              }}
            >
              {PLAN_OPTIONS.map((p) => (
                <option key={p.handle} value={p.handle}>
                  {p.label}
                </option>
              ))}
            </select>
            {fieldErrors.targetHandle && <span className="err">{fieldErrors.targetHandle}</span>}
          </label>

          <label>
            Timing
            <select
              value={timing}
              onChange={(e) => {
                setTiming(e.target.value as Timing);
                setApplied(null);
              }}
            >
              <option value="prorate">Prorate now</option>
              <option value="at-renewal">At renewal</option>
            </select>
          </label>
        </div>

        <button type="submit" disabled={previewing}>
          {previewing ? 'Previewing…' : 'Preview proration'}
        </button>
      </form>

      {transportError && <div className="result error">{transportError}</div>}
      {preview && <PreviewPanel preview={preview} timing={timing} onApply={onApply} applying={applying} />}
      {applied && <AppliedPanel applied={applied} />}
    </div>
  );
}

function PreviewPanel({
  preview,
  timing,
  onApply,
  applying,
}: {
  preview: PlanPreviewResponse;
  timing: Timing;
  onApply: () => void;
  applying: boolean;
}) {
  if (preview.status === 'invalid') {
    return (
      <div className="result error">
        <h3>Please fix the highlighted fields.</h3>
      </div>
    );
  }
  if (preview.status === 'session_expired') {
    return (
      <div className="result error">
        <h3>Transaction not found</h3>
        <p>{preview.message ?? 'Create a subscription first, then retry.'}</p>
      </div>
    );
  }
  if (preview.status === 'maxio_failed') {
    return (
      <div className="result error">
        <h3>⚠️ Preview failed</h3>
        <p>{preview.error}</p>
      </div>
    );
  }
  if (preview.status === 'error') {
    return (
      <div className="result error">
        <h3>Something went wrong</h3>
        <p>{preview.message}</p>
      </div>
    );
  }

  const p = preview.preview;
  return (
    <div className="result success">
      <h3>🔎 Plan change preview</h3>
      <dl>
        <div>
          <dt>Change</dt>
          <dd>
            {p.fromName} → {p.toName}
          </dd>
        </div>
        <div>
          <dt>Prorated charge</dt>
          <dd>{money(p.chargeInCents)}</dd>
        </div>
        <div>
          <dt>Credit applied</dt>
          <dd>{money(p.creditAppliedInCents)}</dd>
        </div>
        <div>
          <dt>Due now</dt>
          <dd>{money(p.paymentDueInCents)}</dd>
        </div>
      </dl>
      {timing === 'at-renewal' && (
        <p className="muted">
          Note: this preview reflects an immediate prorated change. With &quot;At renewal&quot; the
          switch happens next period with no proration.
        </p>
      )}
      <button type="button" onClick={onApply} disabled={applying} style={{ marginTop: '0.75rem' }}>
        {applying
          ? 'Applying…'
          : `Confirm — ${timing === 'prorate' ? 'prorate now' : 'change at renewal'}`}
      </button>
    </div>
  );
}

function AppliedPanel({ applied }: { applied: PlanChangeResponse }) {
  if (applied.status === 'ok') {
    const c = applied.change;
    return (
      <div className="result success">
        <h3>🔄 Plan changed</h3>
        <dl>
          <div>
            <dt>From → To</dt>
            <dd>
              {c.fromName} → {c.toName}
            </dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>
              {c.timing === 'prorate'
                ? 'immediately (prorated)'
                : `at renewal${c.effectiveAt ? ` (${c.effectiveAt})` : ''}`}
            </dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{c.state}</dd>
          </div>
          <div>
            <dt>Slack channel</dt>
            <dd>{applied.channelName ? `#${applied.channelName}` : 'not posted'}</dd>
          </div>
        </dl>
      </div>
    );
  }
  if (applied.status === 'maxio_failed') {
    return (
      <div className="result error">
        <h3>⚠️ Plan change failed</h3>
        <p>{applied.error}</p>
      </div>
    );
  }
  if (applied.status === 'session_expired') {
    return (
      <div className="result error">
        <h3>Transaction not found</h3>
        <p>{applied.message ?? 'Create a subscription first, then retry.'}</p>
      </div>
    );
  }
  if (applied.status === 'invalid') {
    return (
      <div className="result error">
        <h3>Please fix the highlighted fields.</h3>
      </div>
    );
  }
  return (
    <div className="result error">
      <h3>Something went wrong</h3>
      <p>{applied.message}</p>
    </div>
  );
}
