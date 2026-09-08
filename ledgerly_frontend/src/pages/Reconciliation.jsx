import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

export default function Reconciliation() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true); setError("");
    api.get(`/reconciliation/daily?date=${date}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [date]);

  const summary = data?.summary || {};
  const payments = data?.payments || [];
  const byMethod = summary.byMethod || [];

  return (
    <div>
      <h1>End-of-Day Reconciliation</h1>
      <p className="page-intro">Verify cash collected vs payments recorded. Check receipt sequence for gaps.</p>

      <div className="toolbar">
        <div className="toolbar-left">
          <label htmlFor="recon-date" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>Date</label>
          <input type="date" id="recon-date" name="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto", maxWidth: 200 }} />
        </div>
        <button className="btn-ghost" onClick={load}>Refresh</button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="page-loading">Loading…</div>}

      {!loading && data && (
        <>
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-label">Total Collected</div><div className="stat-value" style={{ color: "#1B7A43" }}>{naira(summary.totalCollected || 0)}</div></div>
            <div className="stat-card"><div className="stat-label">Payments</div><div className="stat-value">{summary.totalCount || 0}</div></div>
            <div className="stat-card"><div className="stat-label">Receipts Issued</div><div className="stat-value">{summary.receiptsIssued || 0}</div></div>
            <div className="stat-card"><div className="stat-label">Receipts Voided</div><div className="stat-value" style={{ color: (summary.receiptsVoided || 0) > 0 ? "#B3261E" : "var(--navy)" }}>{summary.receiptsVoided || 0}</div></div>
          </div>

          {byMethod.length > 0 && (
            <div className="card">
              <div className="card-title">By Payment Method</div>
              <div className="table-wrapper">
                <table className="fee-table">
                  <thead><tr><th>Method</th><th className="num">Count</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {byMethod.map((m) => (
                      <tr key={m.method}>
                        <td style={{ fontWeight: 600, textTransform: "capitalize" }}>{m.method?.replace(/_/g, " ")}</td>
                        <td className="num">{m.count}</td>
                        <td className="num" style={{ color: "#1B7A43", fontWeight: 700 }}>{naira(m.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title">Receipt Sequence</div>
            <div className="finance-row"><span>First receipt</span><span>{summary.firstReceipt || "—"}</span></div>
            <div className="finance-row"><span>Last receipt</span><span>{summary.lastReceipt || "—"}</span></div>
            <div className="finance-row">
              <span>Sequence gaps</span>
              <span style={{ color: (summary.gapsInSequence?.length || 0) > 0 ? "#B3261E" : "#1B7A43", fontWeight: 700 }}>
                {summary.gapsInSequence?.length > 0 ? `⚠ ${summary.gapsInSequence.join(", ")}` : "✓ No gaps"}
              </span>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="card">
              <div className="card-title">Payments Recorded ({payments.length})</div>
              <div className="table-wrapper">
                <table className="fee-table">
                  <thead><tr><th>Receipt #</th><th>Student</th><th>Class</th><th>Fee Head</th><th className="num">Amount</th><th>Method</th><th>Status</th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600, color: "var(--navy)" }}>{p.receipt_number || "—"}</td>
                        <td>{p.student_name}</td>
                        <td>{p.student_class}</td>
                        <td>{p.fee_head_name || "—"}</td>
                        <td className="num" style={{ color: "#1B7A43", fontWeight: 700 }}>{naira(p.amount)}</td>
                        <td style={{ textTransform: "capitalize" }}>{p.method?.replace(/_/g, " ")}</td>
                        <td>{p.voided_at ? <span className="badge" style={{ color: "#B3261E", background: "#FBEAE9" }}>Voided</span> : <span className="badge" style={{ color: "#1B7A43", background: "#E6F4EA" }}>Valid</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {payments.length === 0 && !loading && <div className="empty-state">No payments recorded on {date}.</div>}
        </>
      )}
    </div>
  );
}
