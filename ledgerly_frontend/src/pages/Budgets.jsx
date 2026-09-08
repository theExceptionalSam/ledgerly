import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";
import { useTerm } from "../context/TermContext";
import { useAuth } from "../context/AuthContext";

export default function Budgets() {
  const { terms, selectedTermId, setSelectedTermId } = useTerm();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [budgets, setBudgets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [className, setClassName] = useState("");
  const [expectedAmount, setExpectedAmount] = useState("");

  const load = () => {
    if (!selectedTermId) { setLoading(false); return; }
    setLoading(true); setError("");
    Promise.all([
      api.get(`/budgets?termId=${selectedTermId}`),
      api.get(`/budgets/summary?termId=${selectedTermId}`),
    ]).then(([b, s]) => {
      setBudgets(b.budgets || []);
      setSummary(s);
    }).catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [selectedTermId]);

  const save = async () => {
    if (!className || !expectedAmount) return;
    try {
      await api.post("/budgets", { termId: selectedTermId, className, expectedAmount: Number(expectedAmount) });
      setShowForm(false); setClassName(""); setExpectedAmount("");
      load();
    } catch (e) { setError(e.message); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this budget?")) return;
    try { await api.del(`/budgets/${id}`); load(); } catch (e) { setError(e.message); }
  };

  return (
    <div>
      <h1>Budgets</h1>
      <p className="page-intro">Set expected revenue per class per term. Compare budget vs actual collection.</p>

      <div className="term-switcher">
        <label htmlFor="budget-term">Term</label>
        <select id="budget-term" name="termId" value={selectedTermId || ""} onChange={(e) => setSelectedTermId(e.target.value)}>
          {terms.length === 0 && <option value="">No terms</option>}
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_current ? " (current)" : ""}</option>)}
        </select>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="page-loading">Loading…</div>}

      {!loading && summary && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">Total Budget</div><div className="stat-value">{naira(summary.totalBudget || 0)}</div></div>
          <div className="stat-card"><div className="stat-label">Total Collected</div><div className="stat-value" style={{ color: "#1B7A43" }}>{naira(summary.totalActual || 0)}</div></div>
          <div className="stat-card"><div className="stat-label">Variance</div><div className="stat-value" style={{ color: (summary.totalVariance || 0) >= 0 ? "#B3261E" : "#1B7A43" }}>{naira(Math.abs(summary.totalVariance || 0))}{(summary.totalVariance || 0) >= 0 ? " under" : " over"}</div></div>
          <div className="stat-card"><div className="stat-label">Collection Rate</div><div className="stat-value">{summary.totalBudget > 0 ? Math.round((summary.totalActual / summary.totalBudget) * 100) : 0}%</div></div>
        </div>
      )}

      {!loading && (
        <div className="card">
          <div className="toolbar">
            <div className="card-title" style={{ margin: 0 }}>Per-Class Budget</div>
            {isOwner && <button className="btn-primary" onClick={() => setShowForm(!showForm)}>+ Add budget</button>}
          </div>

          {showForm && (
            <div className="budget-form-row" style={{ background: "#FBFBF9", padding: 14, borderRadius: 8, marginBottom: 14 }}>
              <input placeholder="Class name (e.g. JSS 1)" value={className} onChange={(e) => setClassName(e.target.value)} id="budget-class" name="className" />
              <input placeholder="Expected amount" type="number" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} id="budget-amount" name="expectedAmount" inputMode="decimal" />
              <button className="btn-primary" onClick={save}>Save</button>
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          )}

          {budgets.length > 0 && (
            <div className="table-wrapper">
              <table className="fee-table">
                <thead>
                  <tr><th>Class</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Variance</th><th className="num">%</th>{isOwner && <th></th>}</tr>
                </thead>
                <tbody>
                  {budgets.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600, color: "var(--navy)" }}>{b.class_name}</td>
                      <td className="num">{naira(b.expected_amount)}</td>
                      <td className="num" style={{ color: "#1B7A43" }}>{naira(b.actual_collected || 0)}</td>
                      <td className="num" style={{ color: (b.variance || 0) >= 0 ? "#B3261E" : "#1B7A43" }}>{naira(Math.abs(b.variance || 0))}</td>
                      <td className="num">{b.expected_amount > 0 ? Math.round(((b.actual_collected || 0) / b.expected_amount) * 100) : 0}%</td>
                      {isOwner && <td><button className="link-btn" onClick={() => remove(b.id)}>Delete</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {budgets.length === 0 && <div className="empty-state" style={{ marginTop: 14 }}>No budgets set. Click "+ Add budget" to set expected revenue per class.</div>}
        </div>
      )}
    </div>
  );
}
