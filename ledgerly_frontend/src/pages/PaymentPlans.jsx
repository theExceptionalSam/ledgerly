import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";
import { useTerm } from "../context/TermContext";

// Payment plans — split a fee head into N installments with due dates and an
// optional late fee. The plan row tracks the total, installments count, and how
// many have been paid (computed live from the payments table).
//
// Endpoints:
//   GET    /payment-plans        → { plans[] }
//   POST   /payment-plans        { studentId, feeHeadId, termId, totalAmount, installments, dueDates, lateFee }
//   GET    /payment-plans/:id    → { plan: { ..., due_dates: [...], paid_installments }, installments: [payments...] }
//
// Each installment is a row in the payments table linked by (student, fee_head,
// term) — there's no separate installments table. The "installment schedule"
// in the detail view shows due dates alongside actual payments made so far.

function fmtDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "2-digit" });
  } catch { return s; }
}

export default function PaymentPlans() {
  const { terms, selectedTermId, setSelectedTermId } = useTerm();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = () => {
    setLoading(true); setError("");
    api.get("/payment-plans")
      .then((d) => setPlans(d.plans || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const created = () => { setShowCreate(false); load(); };

  return (
    <div>
      <div className="page-intro">
        Payment plans let a family pay a fee head in installments with due dates
        and an optional late fee. Each payment made against the (student, fee
        head, term) is counted as one installment.
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="toolbar">
        <div></div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New plan</button>
      </div>

      {loading && <div className="page-loading">Loading plans…</div>}

      {!loading && plans.length === 0 && (
        <div className="empty-state">No payment plans yet. Create one to split a fee into installments.</div>
      )}

      {!loading && plans.length > 0 && (
        <div className="list">
          {plans.map((p) => (
            <div key={p.id} className="list-item">
              <div className="list-item-row" onClick={() => setDetailId(p.id)}>
                <div className="list-item-main">
                  <div className="list-item-title">
                    {p.student_name} · {p.fee_head_name}
                  </div>
                  <div className="list-item-sub">
                    {p.student_class ? `${p.student_class} · ` : ""}
                    {p.term_name || "—"} · {naira(p.total_amount)} over {p.installments} installment{p.installments === 1 ? "" : "s"}
                    {p.late_fee ? ` · late fee ${naira(p.late_fee)}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ textAlign: "right" }}>
                    <div className="list-item-title" style={{ fontSize: 14 }}>
                      {p.paid_installments}/{p.installments} paid
                    </div>
                    <div className="list-item-sub">
                      {p.status === "active" ? (
                        <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC" }}>Active</span>
                      ) : (
                        <span className="badge" style={{ color: "#8A8A82", background: "#EDECE6", textTransform: "capitalize" }}>{p.status}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePlanModal
          terms={terms}
          defaultTermId={selectedTermId}
          onClose={() => setShowCreate(false)}
          onDone={created}
        />
      )}
      {detailId && (
        <PlanDetailModal id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

function CreatePlanModal({ terms, defaultTermId, onClose, onDone }) {
  const [students, setStudents] = useState([]);
  const [feeHeads, setFeeHeads] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [feeHeadId, setFeeHeadId] = useState("");
  const [termId, setTermId] = useState(defaultTermId || "");
  const [totalAmount, setTotalAmount] = useState("");
  const [installments, setInstallments] = useState("2");
  const [dueDates, setDueDates] = useState([]);
  const [lateFee, setLateFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/students?pageSize=500").then((d) => setStudents(d.students || [])).catch(() => {});
    api.get("/fee-heads").then((d) => setFeeHeads(d.feeHeads || [])).catch(() => {});
  }, []);

  // When installments count changes, re-grow the dueDates array (preserve existing).
  useEffect(() => {
    const n = Math.max(1, Math.min(12, Number(installments) || 1));
    setDueDates((arr) => {
      const next = [...arr];
      while (next.length < n) next.push("");
      next.length = n;
      return next;
    });
  }, [installments]);

  const submit = async () => {
    setError("");
    if (!studentId) { setError("Pick a student."); return; }
    if (!feeHeadId) { setError("Pick a fee head."); return; }
    if (!termId) { setError("Pick a term."); return; }
    if (!(Number(totalAmount) > 0)) { setError("Enter the total amount."); return; }
    const n = Number(installments);
    if (!(n >= 1 && n <= 12)) { setError("Installments must be 1–12."); return; }
    const dates = dueDates.slice(0, n).filter(Boolean);
    if (dates.length !== n) { setError("Set a due date for every installment."); return; }
    setBusy(true);
    try {
      await api.post("/payment-plans", {
        studentId,
        feeHeadId,
        termId,
        totalAmount: Number(totalAmount),
        installments: n,
        dueDates: dates,
        lateFee: lateFee ? Number(lateFee) : 0,
      });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const perInstallment = (Number(totalAmount) || 0) / (Number(installments) || 1);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">New payment plan</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <label htmlFor="plan-student">Student</label>
        <select id="plan-student" name="studentId" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">— Select student —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.class ? ` · ${s.class}` : ""}</option>
          ))}
        </select>

        <label htmlFor="plan-fee-head">Fee head</label>
        <select id="plan-fee-head" name="feeHeadId" value={feeHeadId} onChange={(e) => setFeeHeadId(e.target.value)}>
          <option value="">— Select fee head —</option>
          {feeHeads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>

        <label htmlFor="plan-term">Term</label>
        <select id="plan-term" name="termId" value={termId} onChange={(e) => setTermId(e.target.value)}>
          <option value="">— Select term —</option>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.session_name ? ` (${t.session_name})` : ""}{t.is_current ? " · current" : ""}
            </option>
          ))}
        </select>

        <label htmlFor="plan-total-amount">Total amount (₦)</label>
        <input
          id="plan-total-amount"
          name="totalAmount"
          value={totalAmount}
          onChange={(e) => setTotalAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
        />

        <label htmlFor="plan-installments">Number of installments (1–12)</label>
        <input
          id="plan-installments"
          name="installments"
          type="number"
          min="1"
          max="12"
          value={installments}
          onChange={(e) => setInstallments(e.target.value)}
          autoComplete="off"
        />
        <div className="field-hint">
          ~{naira(perInstallment)} per installment
        </div>

        <label>Due dates</label>
        {dueDates.map((d, i) => (
          <div key={i} className="assign-fee-row" style={{ marginTop: 6 }}>
            <strong style={{ fontSize: 13, color: "#5B5B54", width: 80 }}>Installment {i + 1}</strong>
            <input
              id={`plan-due-date-${i}`}
              name={`dueDate-${i}`}
              type="date"
              value={d}
              onChange={(e) => setDueDates((arr) => arr.map((x, j) => j === i ? e.target.value : x))}
              style={{ flex: 1 }}
              autoComplete="off"
              aria-label={`Due date for installment ${i + 1}`}
            />
          </div>
        ))}

        <label htmlFor="plan-late-fee">Late fee per missed installment (₦, optional)</label>
        <input
          id="plan-late-fee"
          name="lateFee"
          value={lateFee}
          onChange={(e) => setLateFee(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
        />

        <button className="btn-primary btn-full" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Create plan"}
        </button>
      </div>
    </div>
  );
}

function PlanDetailModal({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/payment-plans/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  const plan = data?.plan;
  const installments = data?.installments || [];

  // Compute paid amount + outstanding from the live payments list.
  const paid = installments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const outstanding = plan ? Math.max(0, (Number(plan.total_amount) || 0) - paid) : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <div className="modal-title">Payment plan detail</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {!data && !error && <div className="page-loading">Loading…</div>}

        {plan && (
          <>
            <div className="finance-row"><span>Student</span><span>{plan.student_name}{plan.student_class ? ` · ${plan.student_class}` : ""}</span></div>
            <div className="finance-row"><span>Fee head</span><span>{plan.fee_head_name}</span></div>
            <div className="finance-row"><span>Term</span><span>{plan.term_name}</span></div>
            <div className="finance-row"><span>Total</span><span>{naira(plan.total_amount)}</span></div>
            <div className="finance-row"><span>Installments</span><span>{plan.installments}</span></div>
            <div className="finance-row"><span>Paid installments</span><span style={{ color: "#1B7A43" }}>{plan.paid_installments}</span></div>
            <div className="finance-row"><span>Paid so far</span><span style={{ color: "#1B7A43" }}>{naira(paid)}</span></div>
            <div className="finance-row"><span>Outstanding</span><span style={{ color: outstanding > 0 ? "#B3261E" : "#1B7A43" }}>{naira(outstanding)}</span></div>
            {plan.late_fee ? <div className="finance-row"><span>Late fee</span><span>{naira(plan.late_fee)}</span></div> : null}
            <div className="finance-row"><span>Status</span><span style={{ textTransform: "capitalize" }}>{plan.status}</span></div>

            <div className="card-title" style={{ marginTop: 18 }}>Installment schedule</div>
            <div className="table-wrapper">
            <table className="fee-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due date</th>
                  <th>Paid on</th>
                  <th className="num">Amount</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {(plan.due_dates || []).map((d, i) => {
                  const paid_row = installments[i];
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{fmtDate(d)}</td>
                      <td>{paid_row ? fmtDate(paid_row.paid_on) : <span style={{ color: "#8A8A82" }}>—</span>}</td>
                      <td className="num">{paid_row ? naira(paid_row.amount) : <span style={{ color: "#8A8A82" }}>—</span>}</td>
                      <td>{paid_row?.method ? <span style={{ textTransform: "capitalize" }}>{paid_row.method}</span> : "—"}</td>
                    </tr>
                  );
                })}
                {installments.length > (plan.due_dates || []).length && (
                  // Extra payments beyond the planned schedule
                  installments.slice((plan.due_dates || []).length).map((p, i) => (
                    <tr key={`extra-${i}`}>
                      <td>{(plan.due_dates || []).length + i + 1}</td>
                      <td>—</td>
                      <td>{fmtDate(p.paid_on)}</td>
                      <td className="num">{naira(p.amount)}</td>
                      <td style={{ textTransform: "capitalize" }}>{p.method || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>

            <button className="btn-primary btn-full" onClick={onClose}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}
