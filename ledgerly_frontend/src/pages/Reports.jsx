import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira, statusMeta } from "../utils/format";
import { useTerm } from "../context/TermContext";
import TermSwitcher from "../components/TermSwitcher";

// Reports — aggregated financial data for school owners.
// Calls GET /reports?termId=... and renders four sections:
//   1. Summary cards (reuse .stat-card / .stat-grid classes)
//   2. Monthly collection breakdown
//   3. Defaulter list (sorted by outstanding DESC) with reminder + export
//   4. Fully paid list
//
// All monetary amounts are formatted with naira(); coloured badges use statusMeta.

function StatCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

function badgeFor(outstanding) {
  const key = outstanding > 0 ? "outstanding" : "paid";
  const meta = statusMeta[key];
  return (
    <span className="badge" style={{ color: meta.color, background: meta.bg, marginLeft: 8 }}>
      {meta.label}
    </span>
  );
}

function formatMonth(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-NG", { month: "long", year: "numeric" });
}

export default function Reports() {
  const { selectedTermId, selectedTerm } = useTerm();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedTermId) { setData(null); return; }
    setLoading(true); setError("");
    api.get(`/reports?termId=${selectedTermId}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedTermId]);

  const exportDefaulters = () => {
    if (!selectedTermId) return;
    api.download(`/students/export?termId=${selectedTermId}`, "defaulters.csv");
  };

  const sendReminder = (d) => {
    alert(
      `Reminder ready to send to ${d.name} (${d.class}).\n` +
      `Outstanding: ${naira(d.outstanding)}\n` +
      `Guardian contact: ${d.guardian_contact || "—"}\n\n` +
      `(SMS/email integration not connected yet.)`
    );
  };

  return (
    <div>
      <TermSwitcher />
      {error && <div className="form-error">{error}</div>}
      {!selectedTermId && <div className="empty-state">No term selected. Pick a term to view reports.</div>}
      {selectedTermId && loading && <div className="page-loading">Loading reports…</div>}

      {selectedTermId && data && (
        <>
          {selectedTerm && (
            <div className="field-hint" style={{ marginBottom: 12 }}>
              Showing figures for {selectedTerm.name}.
            </div>
          )}

          {/* 1. Summary cards */}
          <div className="stat-grid">
            <StatCard label="Total expected" value={naira(data.summary.total)} />
            <StatCard label="Total collected" value={naira(data.summary.collected)} accent="#1B7A43" />
            <StatCard label="Outstanding" value={naira(data.summary.outstanding)} accent="#B3261E" />
            <StatCard label="Students" value={data.summary.studentCount} />
          </div>

          {/* 2. Monthly collection */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">Monthly collection</div>
            {data.monthlyCollection.length === 0 ? (
              <div className="empty-state">No payments recorded this term.</div>
            ) : (
              <table className="fee-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Payments</th>
                    <th className="num">Total collected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthlyCollection.map((m) => {
                    const max = Math.max(1, ...data.monthlyCollection.map((x) => x.total));
                    const pct = Math.round((m.total / max) * 100);
                    return (
                      <tr key={m.month}>
                        <td>{formatMonth(m.month)}</td>
                        <td className="num">{m.count}</td>
                        <td className="num">
                          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                            <div style={{ width: 120, height: 8, background: "#EDECE6", borderRadius: 999, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: "#1B7A43" }} />
                            </div>
                            <strong>{naira(m.total)}</strong>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* 3. Defaulter list */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <div className="card-title" style={{ margin: 0 }}>Defaulter list ({data.defaulters.length})</div>
              <button
                className="btn-primary"
                disabled={data.defaulters.length === 0}
                onClick={exportDefaulters}
              >
                Export CSV
              </button>
            </div>
            {data.defaulters.length === 0 ? (
              <div className="empty-state">No defaulters. Every billed student has paid in full.</div>
            ) : (
              <table className="fee-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Class</th>
                    <th className="num">Expected</th>
                    <th className="num">Paid</th>
                    <th className="num">Outstanding</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.defaulters.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.name}
                        {badgeFor(d.outstanding)}
                      </td>
                      <td>{d.class || "—"}</td>
                      <td className="num">{naira(d.expected)}</td>
                      <td className="num">{naira(d.paid)}</td>
                      <td className="num" style={{ color: "#B3261E", fontWeight: 700 }}>{naira(d.outstanding)}</td>
                      <td>
                        <button className="btn-ghost" onClick={() => sendReminder(d)}>Send reminder</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 4. Fully paid list */}
          <div className="card">
            <div className="card-title">Fully paid ({data.fullyPaid.length})</div>
            {data.fullyPaid.length === 0 ? (
              <div className="empty-state">No students have paid in full yet this term.</div>
            ) : (
              <table className="fee-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Class</th>
                    <th className="num">Expected</th>
                    <th className="num">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fullyPaid.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.name}
                        <span className="badge" style={{ color: statusMeta.paid.color, background: statusMeta.paid.bg, marginLeft: 8 }}>
                          {statusMeta.paid.label}
                        </span>
                      </td>
                      <td>{f.class || "—"}</td>
                      <td className="num">{naira(f.expected)}</td>
                      <td className="num">{naira(f.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
