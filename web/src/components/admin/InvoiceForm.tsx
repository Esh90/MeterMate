import { useMemo, useState, type FormEvent } from 'react';
import {
  issueInvoice,
  ApiTransportError,
  type InvoiceLineItem,
  type InvoiceResponse,
} from '../../api.ts';
import { getLastTxn } from '../../lastTxn.ts';

interface LineRow {
  title: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_ROW: LineRow = { title: '', quantity: '1', unitPrice: '' };

/** UC5 — Invoice Issue + Send (admin). Requires admin sign-in. */
export function InvoiceForm({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [txnRef, setTxnRef] = useState(getLastTxn()?.txnId ?? '');
  const [rows, setRows] = useState<LineRow[]>([{ ...EMPTY_ROW }]);
  const [memo, setMemo] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InvoiceResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (result?.status === 'invalid') {
      for (const issue of result.errors) map[issue.path] = issue.message;
    }
    return map;
  }, [result]);

  function updateRow(i: number, patch: Partial<LineRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  const addRow = () => setRows((rs) => [...rs, { ...EMPTY_ROW }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);

    // Only include fully-filled rows; an empty list lets the backend default.
    const lineItems: InvoiceLineItem[] = rows
      .filter((r) => r.title.trim() && r.unitPrice.trim())
      .map((r) => ({
        title: r.title.trim(),
        quantity: Number(r.quantity) || 1,
        unitPrice: r.unitPrice.trim(),
      }));

    try {
      const res = await issueInvoice({
        txnRef: txnRef.trim(),
        ...(lineItems.length ? { lineItems } : {}),
        ...(memo.trim() ? { memo: memo.trim() } : {}),
        sendEmail,
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
      <h2>Issue Invoice</h2>
      <p className="muted">
        Create and issue a Maxio-hosted invoice for the transaction&apos;s subscription, optionally
        emailing it. Leave line items blank to use a default charge. A &quot;Pay Invoice&quot; link
        is posted to the transaction&apos;s Slack channel.
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

        <fieldset className="lineitems">
          <legend>Line items (optional)</legend>
          {rows.map((r, i) => (
            <div className="row lineitem" key={i}>
              <label>
                Title
                <input value={r.title} onChange={(e) => updateRow(i, { title: e.target.value })} />
              </label>
              <label>
                Qty
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={r.quantity}
                  onChange={(e) => updateRow(i, { quantity: e.target.value })}
                />
              </label>
              <label>
                Unit price
                <input
                  value={r.unitPrice}
                  onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                  placeholder="50.00"
                />
              </label>
              {rows.length > 1 && (
                <button type="button" className="ghost" onClick={() => removeRow(i)} aria-label="Remove line">
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="ghost" onClick={addRow}>
            + Add line item
          </button>
        </fieldset>

        <label>
          Memo <span className="muted">(optional)</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Email the invoice to the client
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Issuing…' : 'Issue Invoice'}
        </button>
      </form>

      {transportError && <div className="result error">{transportError}</div>}
      {result && <InvoiceResult result={result} />}
    </div>
  );
}

function InvoiceResult({ result }: { result: InvoiceResponse }) {
  if (result.status === 'ok') {
    const inv = result.invoice;
    return (
      <div className="result success">
        <h3>🧾 Invoice issued</h3>
        <dl>
          <div>
            <dt>Invoice</dt>
            <dd>{inv.number ?? inv.uid}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{inv.status}</dd>
          </div>
          <div>
            <dt>Amount due</dt>
            <dd>${inv.dueAmount ?? inv.totalAmount ?? '0.00'}</dd>
          </div>
          {inv.dueDate && (
            <div>
              <dt>Due date</dt>
              <dd>{inv.dueDate}</dd>
            </div>
          )}
          <div>
            <dt>Emailed</dt>
            <dd>{inv.emailed ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt>Slack channel</dt>
            <dd>{result.channelName ? `#${result.channelName}` : 'not posted'}</dd>
          </div>
        </dl>
        {inv.publicUrl && (
          <a className="paylink" href={inv.publicUrl} target="_blank" rel="noreferrer">
            Pay Invoice ↗
          </a>
        )}
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
        <h3>⚠️ Invoice failed</h3>
        <p>{result.error}</p>
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
