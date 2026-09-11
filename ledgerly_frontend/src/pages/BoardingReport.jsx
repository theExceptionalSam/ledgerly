import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";
import { useTerm } from "../context/TermContext";

// Boarding Students Report — outstanding fees for boarding students only.
//
// Mirrors AgedDebtors.jsx but calls GET /aged-debtors/boarding?termId=…
// instead of /aged-debtors. The backend filters to students whose
// `student_type = 'boarding'` AND who have outstanding balances for the term.
// Useful for bursars tracking boarding-fee defaults separately from tuition.
//
// The response shape matches AgedDebtors: { buckets, total, students: [...] }.
// Each student row carries `studentType: 'boarding'` (echoed for transparency).
export default function BoardingReport() {
  const { terms, selectedTermId, setSelectedTermId } = useTerm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTermId) { setLoading(false); setData(null); return; }
    setLoading(true); setError("");
    api.get(`/aged-debtors/boarding?termId=${selectedTermId}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedTermId]);

  const buckets = data?.buckets || {};
  const total = data?.total || 0;
  const students = data?.students || [];

  return (
    <div>
      <h1>Boarding Students Report</h1>
      <p className="page-intro">Outstanding fees for boarding students only. Use this to chase boarding-fee defaults separately from tuition.</p>

      <div className="term-switcher">
        <label htmlFor="boarding-report-term">Term</label>
        <select
          id="boarding-report-term"
          name="termId"
          value={selectedTermId || ""}
          onChange={(e) => setSelectedTermId(e.target.value)}
        >
          {terms.length === 0 && <option value="">No terms</option>}
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.is_current ? " (current)" : ""}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="page-loading">Loading…</div>}

      {!loading && (
        <>
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-label">0–30 days</div><div className="stat-value" style={{ color: "#1B7A43" }}>{naira(buckets["0-30"] || 0)}</div></div>
            <div className="stat-card"><div className="stat-label">31–60 days</div><div className="stat-value" style={{ color: "#C77D22" }}>{naira(buckets["31-60"] || 0)}</div></div>
            <div className="stat-card"><div className="stat-label">61–90 days</div><div className="stat-value" style={{ color: "#C77D22" }}>{naira(buckets["61-90"] || 0)}</div></div>
            <div className="stat-card"><div className="stat-label">90+ days</div><div className="stat-value" style={{ color: "#B3261E" }}>{naira(buckets["90+"] || 0)}</div></div>
          </div>

          <div className="card">
            <div className="card-title">Total Outstanding (Boarding): {naira(total)}</div>
          </div>

          {students.length > 0 && (
            <div className="card">
              <div className="card-title">Boarding Student Breakdown</div>
              <div className="table-wrapper">
                <table className="fee-table">
                  <thead>
                    <tr><th>Student</th><th>Class</th><th>Type</th><th className="num">Expected</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Days Overdue</th><th>Bucket</th></tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.studentId}>
                        <td style={{ fontWeight: 600, color: "var(--navy)" }}>{s.studentName}</td>
                        <td>{s.class}</td>
                        <td>
                          <span
                            className="badge student-type-badge boarding"
                            title="Boarding student"
                            style={{ color: "#14213D", background: "#E4E3DD" }}
                          >
                            Boarding
                          </span>
                        </td>
                        <td className="num">{naira(s.expected)}</td>
                        <td className="num" style={{ color: "#1B7A43" }}>{naira(s.paid)}</td>
                        <td className="num" style={{ color: "#B3261E", fontWeight: 700 }}>{naira(s.outstanding)}</td>
                        <td>{s.daysOverdue}</td>
                        <td>
                          <span className="badge" style={{ color: s.bucket === "0-30" ? "#1B7A43" : s.bucket === "90+" ? "#B3261E" : "#C77D22", background: s.bucket === "0-30" ? "#E6F4EA" : s.bucket === "90+" ? "#FBEAE9" : "#FBF0E2" }}>
                            {s.bucket}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {students.length === 0 && !loading && (
            <div className="empty-state">No boarding students with outstanding fees for this term. 🎉</div>
          )}
        </>
      )}
    </div>
  );
}
