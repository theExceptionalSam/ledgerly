import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Bank reconciliation — upload a bank statement CSV; the backend auto-matches
// credits to recorded payments by amount ±2 days. Owner/accountant then reviews
// the table and manually matches any misses (or unmatches wrong auto-matches).
//
// Endpoints:
//   POST   /bank-reconciliation/upload            multipart "file" → { id, total, matched, unmatched }
//   GET    /bank-reconciliation/:statementId      → { statement, transactions[] }
//   POST   /bank-reconciliation/:statementId/match    { bankTransactionId, paymentId }
//   POST   /bank-reconciliation/:statementId/unmatch { bankTransactionId }
//
// The latest statementId is persisted to localStorage so a refresh doesn't lose
// context. There is no list-statements endpoint yet — the page manages one
// active statement at a time.
//
// The "match" UI uses /search?q=... to find a candidate payment (no list-
// payments endpoint exists). Search returns payments with amount, paid_on,
// student_name, fee_head_name — enough context for the owner to pick.

const STORAGE_KEY = "ledgerly_bank_recon_stmt";

function statusBadge(status) {
  if (status === "matched") {
    return <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC" }}>Matched</span>;
  }
  return <span className="badge" style={{ color: "#C77D22", background: "#FBF0E2" }}>Unmatched</span>;
}

function fmtDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return s;
  }
}

export default function BankReconciliation() {
  const [statementId, setStatementId] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [statement, setStatement] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [matchFor, setMatchFor] = useState(null); // bank transaction row to match
  const fileRef = useRef(null);

  const loadStatement = (id) => {
    if (!id) { setStatement(null); setTransactions([]); return; }
    setLoading(true); setError("");
    api.get(`/bank-reconciliation/${id}`)
      .then((d) => { setStatement(d.statement); setTransactions(d.transactions || []); })
      .catch((e) => { setError(e.message); setStatement(null); setTransactions([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (statementId) loadStatement(statementId);
  }, [statementId]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(""); setNotice("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.upload("/bank-reconciliation/upload", fd);
      localStorage.setItem(STORAGE_KEY, res.id);
      setStatementId(res.id);
      setNotice(`Uploaded ${res.total} transactions — ${res.matched} auto-matched, ${res.unmatched} unmatched.`);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const onMatched = () => {
    setMatchFor(null);
    loadStatement(statementId);
  };

  const onUnmatched = async (bankTransactionId) => {
    if (!confirm("Unmatch this transaction? Its payment will be available for re-matching.")) return;
    setError("");
    try {
      await api.post(`/bank-reconciliation/${statementId}/unmatch`, { bankTransactionId });
      loadStatement(statementId);
    } catch (e) {
      setError(e.message);
    }
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStatementId("");
    setStatement(null);
    setTransactions([]);
    setNotice("");
    setError("");
  };

  const matched = statement?.matched ?? 0;
  const unmatched = statement?.unmatched ?? 0;
  const total = statement?.total_records ?? transactions.length;

  return (
    <div>
      <div className="page-intro">
        Upload a bank statement CSV (columns: <code>date</code>, <code>description</code>, <code>amount</code>).
        Credits are auto-matched to recorded payments by amount ±2 days. Review and manually
        match or unmatch any rows below.
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && (
        <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF", marginBottom: 16 }}>
          {notice}
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Upload bank statement</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            disabled={uploading}
            style={{ flex: 1, minWidth: 240 }}
          />
          {uploading && <span className="field-hint" style={{ margin: 0 }}>Uploading &amp; matching…</span>}
          {statementId && (
            <button className="btn-ghost" onClick={reset}>Start new</button>
          )}
        </div>
        <div className="field-hint">
          Max 2 MB. Credits (positive amounts) are reconciled; debits are listed for reference only.
        </div>
      </div>

      {loading && <div className="page-loading">Loading statement…</div>}

      {!loading && statement && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Total rows</div>
              <div className="stat-value">{total}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Matched</div>
              <div className="stat-value" style={{ color: "#1B7A43" }}>{matched}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Unmatched</div>
              <div className="stat-value" style={{ color: "#C77D22" }}>{unmatched}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Status</div>
              <div className="stat-value" style={{ fontSize: 16, textTransform: "capitalize" }}>{statement.status}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Transactions · {statement.filename}</div>
            {transactions.length === 0 ? (
              <div className="empty-state">No transactions in this statement.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="fee-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                      <th>Matched payment</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{fmtDate(t.date)}</td>
                        <td>{t.description || <span style={{ color: "#8A8A82" }}>—</span>}</td>
                        <td className="num" style={{ color: t.amount >= 0 ? "#1B7A43" : "#B3261E", fontWeight: 700 }}>
                          {naira(t.amount)}
                        </td>
                        <td>
                          {t.matched_payment_id ? (
                            <span style={{ fontSize: 13 }}>
                              {t.student_name || "—"}
                              {t.fee_head_name ? ` · ${t.fee_head_name}` : ""}
                              {t.payment_amount ? ` · ${naira(t.payment_amount)}` : ""}
                            </span>
                          ) : (
                            <span style={{ color: "#8A8A82", fontSize: 13 }}>—</span>
                          )}
                        </td>
                        <td>{statusBadge(t.status)}</td>
                        <td>
                          {t.status === "matched" ? (
                            <button className="btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => onUnmatched(t.id)}>
                              Unmatch
                            </button>
                          ) : (
                            <button className="btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setMatchFor(t)}>
                              Match
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!loading && !statement && !statementId && (
        <div className="empty-state">Upload a CSV above to begin reconciliation.</div>
      )}

      {matchFor && (
        <MatchModal
          statementId={statementId}
          bankTransaction={matchFor}
          onClose={() => setMatchFor(null)}
          onDone={onMatched}
        />
      )}
    </div>
  );
}

/* ---------- Match picker modal ---------- */
// Searches /search?q=... for candidate payments (by note or amount) and lets
// the owner pick one to match the unmatched bank row against.

function MatchModal({ statementId, bankTransaction, onClose, onDone }) {
  const [query, setQuery] = useState(String(Math.abs(bankTransaction.amount || "")));
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true); setError("");
      api.get(`/search?q=${encodeURIComponent(query.trim())}`)
        .then((d) => setResults(d.payments || []))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const pick = async (paymentId) => {
    setBusy(true); setError("");
    try {
      await api.post(`/bank-reconciliation/${statementId}/match`, {
        bankTransactionId: bankTransaction.id,
        paymentId,
      });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">Find a payment to match</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="field-hint" style={{ marginBottom: 8 }}>
          Bank row: <strong>{fmtDate(bankTransaction.date)}</strong> ·{" "}
          <strong style={{ color: "#1B7A43" }}>{naira(bankTransaction.amount)}</strong>
          {bankTransaction.description ? ` · ${bankTransaction.description}` : ""}
        </div>

        {error && <div className="form-error">{error}</div>}

        <label>Search by amount or note</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. 50000 or Tuition"
          autoFocus
        />
        <div className="field-hint">Type at least 2 characters. Matches by amount (exact) or note (partial).</div>

        {loading && <div className="field-hint" style={{ marginTop: 12 }}>Searching…</div>}

        {!loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="empty-state" style={{ marginTop: 12 }}>No payments found.</div>
        )}

        {!loading && results.length > 0 && (
          <div className="list" style={{ marginTop: 12 }}>
            {results.map((p) => (
              <div key={p.id} className="list-item">
                <div className="list-item-row" style={{ cursor: "default" }}>
                  <div className="list-item-main">
                    <div className="list-item-title">{naira(p.amount)}</div>
                    <div className="list-item-sub">
                      {p.student_name || "—"}{p.fee_head_name ? ` · ${p.fee_head_name}` : ""}
                      {" · "}{fmtDate(p.paid_on)}
                      {p.method ? ` · ${p.method}` : ""}
                      {p.note ? ` · ${p.note}` : ""}
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => pick(p.id)}
                    style={{ padding: "6px 12px", fontSize: 13 }}
                  >
                    Match
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
