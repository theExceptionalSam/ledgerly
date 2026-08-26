import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";
import { useTerm } from "../context/TermContext";
import TermSwitcher from "../components/TermSwitcher";

function StatCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

function Row({ label, value, bold, accent }) {
  return (
    <div className="finance-row">
      <span>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 600, color: accent }}>{value}</span>
    </div>
  );
}

export default function Dashboard() {
  const { selectedTermId, selectedTerm } = useTerm();
  const [totals, setTotals] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTermId) { setTotals(null); return; }
    setError("");
    api.get(`/dashboard?termId=${selectedTermId}`).then(setTotals).catch((e) => setError(e.message));
  }, [selectedTermId]);

  return (
    <div>
      <TermSwitcher />
      {error && <div className="form-error">{error}</div>}
      {!selectedTermId && <div className="empty-state">No term selected. Create a term to see dashboard figures.</div>}
      {selectedTermId && !totals && !error && <div className="page-loading">Loading dashboard…</div>}
      {selectedTermId && totals && (
        <>
          {selectedTerm && <div className="field-hint" style={{ marginBottom: 12 }}>Showing figures for {selectedTerm.name}.</div>}
          <div className="card">
            <div className="progress-header">
              <span>Fee collection progress</span>
              <strong>{totals.expected > 0 ? Math.round((totals.collected / totals.expected) * 100) : 0}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${totals.expected > 0 ? Math.round((totals.collected / totals.expected) * 100) : 0}%` }} />
            </div>
            <div className="progress-footer">
              <span>Collected {naira(totals.collected)}</span>
              <span>Expected {naira(totals.expected)}</span>
            </div>
          </div>

          <div className="stat-grid">
            <StatCard label="Expected (all students)" value={naira(totals.expected)} />
            <StatCard label="Collected so far" value={naira(totals.collected)} accent="#1B7A43" />
            <StatCard label="Outstanding fees" value={naira(totals.outstanding)} accent="#B3261E" />
            <StatCard label="Students on record" value={totals.studentCount} />
          </div>

          <div className="stat-grid stat-grid-3">
            <StatCard label="Fully paid" value={totals.fullyPaid} accent="#1B7A43" />
            <StatCard label="Partial" value={totals.partial} accent="#C77D22" />
            <StatCard label="Outstanding" value={totals.fullyOutstanding} accent="#B3261E" />
          </div>

          <div className="card">
            <div className="card-title">School finances</div>
            <Row label="Fees collected" value={naira(totals.collected)} />
            <Row label="Other income" value={naira(totals.otherIncome)} />
            <Row label="Expenditure" value={"-" + naira(totals.expenditure)} accent="#B3261E" />
            <div className="divider" />
            <Row label="Net position" value={naira(totals.netPosition)} bold accent={totals.netPosition >= 0 ? "#1B7A43" : "#B3261E"} />
          </div>
        </>
      )}
    </div>
  );
}
