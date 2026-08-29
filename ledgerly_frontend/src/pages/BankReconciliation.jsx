import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Bank reconciliation — upload a bank statement CSV; the backend auto-matches
// credits to recorded payments by amount ±2 days. Owner/accountant then reviews
// the table and manually matches any misses (or unmatches wrong auto-matches).
//
// Endpoints:
//   GET    /bank-reconciliation            → { statements: [{ id, filename, status, total_records, matched, unmatched, created_at }] }
//   POST   /bank-reconciliation/upload            multipart "file" → { id, total, matched, unmatched }
//   GET    /bank-reconciliation/:statementId      → { statement, transactions[] }
//   POST   /bank-reconciliation/:statementId/match    { bankTransactionId, paymentId }
//   POST   /bank-reconciliation/:statementId/unmatch { bankTransactionId }
//
// The active statementId is persisted to localStorage as a fallback (so a
// refresh keeps context), but the primary way to switch between statements is
// the "Statement history" list, populated from GET /bank-reconciliation.
//
// The "match" UI loads unmatched payments via GET /payments?unmatched=true and
// filters them client-side (by amount, date, student name, fee head, or note).

const STORAGE_KEY = "ledgerly_bank_recon_stmt";

function txnStatusBadge(status) {
  if (status === "matched") {
    return <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC" }}>Matched</span>;
  }
  return <span className="badge" style={{ color: "#C77D22", background: "#FBF0E2" }}>Unmatched</span>;
}

function stmtStatusBadge(status) {
  const map = {
    completed: { label: "Completed", color: "#1B7A43", bg: "#E7F4EC" },
    processing: { label: "Processing", color: "#14213D", bg: "#EDEFF4" },
    pending: { label: "Pending", color: "#C77D22", bg: "#FBF0E2" },
    failed: { label: "Failed", color: "#B3261E", bg: "#FBEAE9" },
  };
  const m = map[status] || { label: status || "—", color: "#5B5B54", bg: "#EDECE6" };
  return <span className="badge" style={{ color: m.color, background: m.bg }}>{m.label}</span>;
}

function fmtDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return s;
  }
}

function fmtDateTime(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
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

  // Statement history (list of all uploads for this tenant).
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fileRef = useRef(null);

  const loadHistory = () => {
    setHistoryLoading(true);
    api.get("/bank-reconciliation")
      .then((d) => setHistory(d.statements || []))
      .catch(() => { /* keep silent — history is a convenience */ })
      .finally(() => setHistoryLoading(false));
  };

  const loadStatement = (id) => {
    if (!id) { setStatement(null); setTransactions([]); return; }
    setLoading(true); setError("");
    api.get(`/bank-reconciliation/${id}`)
      .then((d) => { setStatement(d.statement); setTransactions(d.transactions || []); })
      .catch((e) => { setError(e.message); setStatement(null); setTransactions([]); })
      .finally(() => setLoading(false));
  };

  // Initial mount: load history, and if a localStorage id is present, load it.
  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (statementId) loadStatement(statementId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      loadHistory(); // refresh the sidebar so the new upload appears
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const onMatched = () => {
    setMatchFor(null);
    loadStatement(statementId);
    loadHistory(); // matched/unmatched counts may have shifted
  };

  const onUnmatched = async (bankTransactionId) => {
    if (!confirm("Unmatch this transaction? Its payment will be available for re-matching.")) return;
    setError("");
    try {
      await api.post(`/bank-reconciliation/${statementId}/unmatch`, { bankTransactionId });
      loadStatement(statementId);
      loadHistory();
    } catch (e) {
      setError(e.message);
    }
  };

  const selectStatement = (id) => {
    localStorage.setItem(STORAGE_KEY, id);
    setStatementId(id);
    setNotice("");
    setError("");
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStatementId("");
    setStatement(null);
    setTransactions([]);
    setNotice("");
    setError("");
    // history stays visible — that's the primary switching surface now
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

      {/* Statement history — the primary way to switch between uploads */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Statement history</div>
        {historyLoading && <div className="field-hint" style={{ marginTop: 0 }}>Loading history…</div>}
        {!historyLoading && history.length === 0 && (
          <div className="empty-state">No statements uploaded yet.</div>
        )}
        {!historyLoading && history.length > 0 && (
          <div className="list">
            {history.map((s) => {
              const active = s.id === statementId;
              return (
                <div
                  key={s.id}
                  className="list-item"
                  style={{
                    cursor: "pointer",
                    borderColor: active ? "#14213D" : undefined,
                    background: active ? "#F2F3F8" : undefined,
                  }}
                  onClick={() => selectStatement(s.id)}
                >
                  <div className="list-item-row" style={{ cursor: "pointer" }}>
                    <div className="list-item-main">
                      <div className="list-item-title" style={{ wordBreak: "break-all" }}>
                        {s.filename || "Untitled statement"}
                      </div>
                      <div className="list-item-sub">
                        {fmtDateTime(s.created_at)}
                        {" · "}{stmtStatusBadge(s.status)}
                        {" · "}<span style={{ color: "#1B7A43" }}>{s.matched ?? 0} matched</span>
                        {" · "}<span style={{ color: "#C77D22" }}>{s.unmatched ?? 0} unmatched</span>
                        {" · "}{s.total_records ?? 0} rows
                        {active && <span style={{ color: "#14213D", fontWeight: 700 }}> · viewing</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="field-hint" style={{ marginTop: 10 }}>
          Click any statement to load it. The most recent upload appears at the top.
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
                        <td>{txnStatusBadge(t.status)}</td>
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
        <div className="empty-state">Upload a CSV above, or pick a past statement from the history list.</div>
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
// Loads unmatched payments via GET /payments?unmatched=true and lets the owner
// pick one to match the unmatched bank row against. The search box filters the
// loaded set client-side: a numeric query filters by amount, a date query
// filters by paid_on, and any other text filters by student name, fee head,
// or note. The box is pre-filled with the bank row's absolute amount so the
// most likely match surfaces immediately.

function MatchModal({ statementId, bankTransaction, onClose, onDone }) {
  const [query, setQuery] = useState(String(Math.abs(bankTransaction.amount || "")));
  const [all, setAll] = useState([]); // all unmatched payments (page 1)
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Load unmatched payments once on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api.get("/payments?unmatched=true&page=1&pageSize=50")
      .then((d) => {
        if (cancelled) return;
        const list = d.payments || [];
        setAll(list);
        setResults(applyFilter(list, query));
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-filter client-side whenever the query changes.
  useEffect(() => {
    setResults(applyFilter(all, query));
  }, [query, all]);

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

        <label>Filter by amount, date, or note</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. 50000 or Tuition or 2024-09"
          autoFocus
        />
        <div className="field-hint">
          Showing unmatched payments only. Type a number to filter by amount,
          a date (YYYY-MM-DD) to filter by paid date, or text to match student
          name, fee head, or note.
        </div>

        {loading && <div className="field-hint" style={{ marginTop: 12 }}>Loading unmatched payments…</div>}

        {!loading && results.length === 0 && (
          <div className="empty-state" style={{ marginTop: 12 }}>
            {all.length === 0
              ? "No unmatched payments available."
              : "No payments match this filter."}
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="list" style={{ marginTop: 12 }}>
            {results.map((p) => (
              <div key={p.id} className="list-item">
                <div className="list-item-row" style={{ cursor: "default" }}>
                  <div className="list-item-main">
                    <div className="list-item-title" style={{ color: "#1B7A43" }}>{naira(p.amount)}</div>
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

// Client-side filter for the loaded unmatched payments list.
// - pure number (digits, commas, dots) → match by amount (exact)
// - YYYY[-MM[-DD]] → match by paid_on prefix
// - anything else → substring match on student_name, fee_head_name, note, or amount string
function applyFilter(payments, query) {
  if (!query || !query.trim()) return payments;
  const q = query.trim();
  const qLower = q.toLowerCase();

  const cleanedNum = q.replace(/,/g, "");
  const isNumeric = /^-?\d+(\.\d+)?$/.test(cleanedNum);
  const num = isNumeric ? Number(cleanedNum) : NaN;

  const isDateLike = /^\d{4}(-\d{2}(-\d{2})?)?$/.test(q);

  return payments.filter((p) => {
    if (isNumeric && p.amount != null && Math.abs(Number(p.amount) - num) < 0.01) return true;
    if (isDateLike && p.paid_on && String(p.paid_on).startsWith(q)) return true;
    if ((p.student_name || "").toLowerCase().includes(qLower)) return true;
    if ((p.fee_head_name || "").toLowerCase().includes(qLower)) return true;
    if ((p.note || "").toLowerCase().includes(qLower)) return true;
    if (String(p.amount || "").includes(q)) return true;
    return false;
  });
}
