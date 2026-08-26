import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira, statusMeta } from "../utils/format";
import { useAuth } from "../context/AuthContext";
import { useTerm } from "../context/TermContext";
import TermSwitcher from "../components/TermSwitcher";

const CLASS_LIST = [
  "Creche", "Nursery 1", "Nursery 2",
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SS 1", "SS 2", "SS 3",
];

export default function Students() {
  const { user } = useAuth();
  const { selectedTermId } = useTerm();
  const [students, setStudents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [feeHeads, setFeeHeads] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("fees");

  const canEdit = ["owner", "bursar", "accountant"].includes(user.role);
  const isOwner = user.role === "owner";

  const load = () => {
    if (!selectedTermId) return;
    api.get(`/students?termId=${selectedTermId}`).then((d) => setStudents(d.students)).catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, [selectedTermId]);

  useEffect(() => {
    api.get("/fee-heads").then((d) => setFeeHeads(d.feeHeads)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!expanded || !selectedTermId) { setDetail(null); return; }
    setTab("fees");
    api.get(`/students/${expanded}?termId=${selectedTermId}`).then(setDetail).catch((e) => setError(e.message));
  }, [expanded, selectedTermId]);

  // Counts per status — computed from the full students list (before search
  // filtering) so the chips always show the true totals for this term.
  const counts = {
    all: students.length,
    paid: students.filter((s) => s.status === "paid").length,
    partial: students.filter((s) => s.status === "partial").length,
    outstanding: students.filter((s) => s.status === "outstanding").length,
  };

  const filtered = students.filter((s) => {
    if (filter !== "all" && s.status !== filter) return false;
    if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const addStudent = async (fields) => {
    await api.post("/students", fields);
    setShowAdd(false);
    load();
  };

  const recordPayments = async (studentId, lines, payment) => {
    for (const line of lines) {
      await api.post("/payments", {
        studentId, amount: line.amount, method: payment.method, note: payment.note,
        paidOn: payment.paidOn, feeHeadId: line.feeHeadId, termId: selectedTermId,
        idempotencyKey: `${studentId}-${Date.now()}-${line.feeHeadId}`,
      });
    }
    setPayFor(null);
    load();
    if (expanded === studentId) api.get(`/students/${studentId}?termId=${selectedTermId}`).then(setDetail);
    return lines.map((l) => ({ ...l }));
  };

  const assignFee = async (studentId, feeHeadId, amount) => {
    await api.post(`/students/${studentId}/fees`, { feeHeadId, termId: selectedTermId, expectedAmount: amount });
    if (expanded === studentId) api.get(`/students/${studentId}?termId=${selectedTermId}`).then(setDetail);
  };

  const applyDiscount = async (studentId, assignmentId, amount, reason) => {
    await api.post(`/students/${studentId}/fees/${assignmentId}/discount`, { discountAmount: amount, discountReason: reason });
    if (expanded === studentId) api.get(`/students/${studentId}?termId=${selectedTermId}`).then(setDetail);
  };

  const archive = async (id, name) => {
    if (!confirm(`Remove ${name} from active records? Payment history is kept for audit purposes.`)) return;
    await api.del(`/students/${id}`);
    setExpanded(null);
    load();
  };

  const openReceipt = (paymentId) => {
    api.openPdf(`/payments/${paymentId}/receipt`).catch((e) => alert(e.message));
  };

  return (
    <div>
      <TermSwitcher />
      {!selectedTermId && <div className="empty-state">No term selected.</div>}
      {selectedTermId && (
        <>
          {error && <div className="form-error">{error}</div>}
          <div className="toolbar">
            <input className="search-input" placeholder="Search student" value={query} onChange={(e) => setQuery(e.target.value)} />
            {canEdit && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-primary" onClick={() => setShowUpload(true)}>Upload Excel</button>
                <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add</button>
              </div>
            )}
          </div>

          <div className="filter-row">
            {["all", "paid", "partial", "outstanding"].map((f) => (
              <button key={f} className={"filter-chip" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : statusMeta[f].label}
                <span className="chip-count">{counts[f]}</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 && <div className="empty-state">No students match yet.</div>}

          <div className="list">
            {filtered.map((s) => {
              const meta = statusMeta[s.status];
              const isOpen = expanded === s.id;
              return (
                <div key={s.id} className="list-item">
                  <div className="list-item-row" onClick={() => setExpanded(isOpen ? null : s.id)}>
                    <div>
                      <div className="list-item-title">{s.name}</div>
                      <div className="list-item-sub">
                        {s.class}{s.admission_no ? " · " + s.admission_no : ""}
                        {s.guardian_contact ? " · Parent: " + s.guardian_contact : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className="badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                      <div className="list-item-amount">{naira(s.paid)} / {naira(s.expected)}</div>
                    </div>
                  </div>

                  {isOpen && detail && (
                    <div className="list-item-detail">
                      <div className="detail-tabs">
                        <button className={"tab-btn" + (tab === "fees" ? " active" : "")} onClick={() => setTab("fees")}>Fees</button>
                        <button className={"tab-btn" + (tab === "payments" ? " active" : "")} onClick={() => setTab("payments")}>Payments</button>
                      </div>

                      {tab === "fees" && (
                        <FeeTable
                          fees={detail.fees}
                          feeHeads={feeHeads}
                          isOwner={isOwner}
                          canEdit={canEdit}
                          onAssign={assignFee}
                          onDiscount={applyDiscount}
                          studentId={s.id}
                        />
                      )}

                      {tab === "payments" && (
                        <div>
                          {detail.payments.length === 0 && <div className="empty-state" style={{ padding: "16px" }}>No payments recorded for this term.</div>}
                          {detail.payments.length > 0 && (
                            <div className="payment-history">
                              <div className="payment-history-title">Payment history</div>
                              {detail.payments.map((p) => (
                                <div key={p.id} className="payment-history-row">
                                  <span>{p.paid_on} · {p.fee_head_name || "General"}{p.note ? " · " + p.note : ""}</span>
                                  <span className="payment-history-right">
                                    {naira(p.amount)}
                                    <button className="link-btn" onClick={() => openReceipt(p.id)}>Receipt</button>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {canEdit && (
                        <div className="action-row">
                          <button className="btn-primary" style={{ flex: 1 }} onClick={() => setPayFor(s.id)}>Record payment</button>
                          <button className="btn-danger-ghost" onClick={() => archive(s.id, s.name)}>Remove</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {showAdd && <AddStudentModal onClose={() => setShowAdd(false)} onSave={addStudent} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={load} />}
      {payFor && (
        <PaymentModal
          student={students.find((s) => s.id === payFor)}
          fees={detail?.fees || []}
          onClose={() => setPayFor(null)}
          onSave={(lines, payment) => recordPayments(payFor, lines, payment)}
          onReceipt={openReceipt}
        />
      )}
    </div>
  );
}

function FeeTable({ fees, feeHeads, isOwner, canEdit, onAssign, onDiscount, studentId }) {
  const [assigning, setAssigning] = useState(null);
  const [discountFor, setDiscountFor] = useState(null);

  const assignedHeadIds = new Set(fees.map((f) => f.fee_head_id));
  const unassigned = feeHeads.filter((h) => !assignedHeadIds.has(h.id));

  const totalExpected = fees.reduce((s, f) => s + f.expected_amount, 0);
  const totalDiscount = fees.reduce((s, f) => s + f.discount_amount, 0);
  const totalPaid = fees.reduce((s, f) => s + f.paid, 0);
  const totalOutstanding = fees.reduce((s, f) => s + f.outstanding, 0);

  return (
    <div>
      {fees.length === 0 && <div className="empty-state" style={{ padding: "16px" }}>No fees assigned for this term yet.</div>}
      {fees.length > 0 && (
        <table className="fee-table">
          <thead>
            <tr><th>Fee Head</th><th className="num">Expected</th><th className="num">Discount</th><th className="num">Paid</th><th className="num">Outstanding</th>{isOwner && <th></th>}</tr>
          </thead>
          <tbody>
            {fees.map((f) => (
              <tr key={f.id}>
                <td>{f.fee_head_name}</td>
                <td className="num">{naira(f.expected_amount)}</td>
                <td className="num">{f.discount_amount > 0 ? <span style={{ color: "#C77D22" }}>{naira(f.discount_amount)}</span> : "—"}</td>
                <td className="num">{naira(f.paid)}</td>
                <td className="num" style={{ color: f.outstanding > 0 ? "#B3261E" : "#1B7A43", fontWeight: 700 }}>{naira(f.outstanding)}</td>
                {isOwner && <td>{canEdit && <button className="link-btn" onClick={() => setDiscountFor(f)}>Discount</button>}</td>}
              </tr>
            ))}
            <tr className="fee-table-total">
              <td>Total</td>
              <td className="num">{naira(totalExpected)}</td>
              <td className="num">{totalDiscount > 0 ? naira(totalDiscount) : "—"}</td>
              <td className="num">{naira(totalPaid)}</td>
              <td className="num">{naira(totalOutstanding)}</td>
              {isOwner && <td></td>}
            </tr>
          </tbody>
        </table>
      )}

      {canEdit && unassigned.length > 0 && (
        <div className="assign-fee-row">
          <strong>Assign fee:</strong>
          {unassigned.map((h) => (
            <button key={h.id} className="filter-chip" onClick={() => setAssigning(h)}>{h.name}</button>
          ))}
        </div>
      )}

      {assigning && (
        <QuickAmountModal
          title={`Assign ${assigning.name}`}
          onClose={() => setAssigning(null)}
          onSave={async (amount) => { await onAssign(studentId, assigning.id, amount); setAssigning(null); }}
        />
      )}

      {discountFor && (
        <QuickDiscountModal
          feeHeadName={discountFor.fee_head_name}
          currentDiscount={discountFor.discount_amount}
          onClose={() => setDiscountFor(null)}
          onSave={async (amount, reason) => { await onDiscount(studentId, discountFor.id, amount, reason); setDiscountFor(null); }}
        />
      )}
    </div>
  );
}

function QuickAmountModal({ title, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await onSave(Number(amount) || 0); } finally { setBusy(false); } };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">{title}</div><button className="modal-close" onClick={onClose}>✕</button></div>
        <label>Expected amount (₦)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" autoFocus />
        <button className="btn-primary btn-full" disabled={busy} onClick={submit}>{busy ? "Saving..." : "Assign"}</button>
      </div>
    </div>
  );
}

function QuickDiscountModal({ feeHeadName, currentDiscount, onClose, onSave }) {
  const [amount, setAmount] = useState(String(currentDiscount || ""));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await onSave(Number(amount) || 0, reason); } finally { setBusy(false); } };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">Discount · {feeHeadName}</div><button className="modal-close" onClick={onClose}>✕</button></div>
        <label>Discount amount (₦)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" autoFocus />
        <label>Reason (optional)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn-primary btn-full" disabled={busy} onClick={submit}>{busy ? "Saving..." : "Apply discount"}</button>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddStudentModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [klass, setKlass] = useState(CLASS_LIST[0]);
  const [admissionNo, setAdmissionNo] = useState("");
  const [guardianContact, setGuardianContact] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await onSave({ name, class: klass, admissionNo, guardianContact });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Add student" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <div className="field-hint" style={{ marginTop: 0 }}>Fee heads are assigned after the student is created, from the student detail view.</div>
      <label>Full name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amaka Johnson" autoFocus />
      <label>Class</label>
      <select value={klass} onChange={(e) => setKlass(e.target.value)}>
        {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label>Admission number (optional)</label>
      <input value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} />
      <label>Parent contact</label>
      <input value={guardianContact} onChange={(e) => setGuardianContact(e.target.value)} placeholder="e.g. 0803 123 4567" inputMode="tel" />
      <button className="btn-primary btn-full" disabled={!name || busy} onClick={submit}>
        {busy ? "Saving..." : "Add student"}
      </button>
    </Modal>
  );
}

function UploadModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await api.upload("/students/bulk", form);
      setResult(data);
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Upload students from Excel" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      {result ? (
        <div>
          <div className="finance-row"><span>Students imported</span><span style={{ color: "#1B7A43", fontWeight: 700 }}>{result.imported}</span></div>
          {result.failed.length > 0 && (
            <div className="payment-history">
              <div className="payment-history-title">Skipped rows</div>
              {result.failed.map((f, i) => (
                <div key={i} className="payment-history-row"><span>Row {f.row}</span><span style={{ color: "#B3261E" }}>{f.reason}</span></div>
              ))}
            </div>
          )}
          <button className="btn-primary btn-full" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div>
          <p className="field-hint" style={{ marginTop: 0 }}>
            First row must have: <strong>Name, Class, Admission No, Parent Contact</strong>. Fee heads are assigned after import.
          </p>
          <a className="field-hint" href="#" onClick={(e) => { e.preventDefault(); api.download("/students/bulk/template", "ledgerly-students-template.xlsx"); }}>
            Download the template file
          </a>
          <label>Choose file (.xlsx, .xls or .csv)</label>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button className="btn-primary btn-full" disabled={!file || busy} onClick={submit}>
            {busy ? "Uploading..." : "Upload and import"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function PaymentModal({ student, fees, onClose, onSave, onReceipt }) {
  const [lines, setLines] = useState(() => {
    // Default: one line for the fee head with the largest outstanding balance.
    const withOutstanding = fees.filter((f) => f.outstanding > 0);
    const defaultHead = withOutstanding.length > 0
      ? withOutstanding.reduce((a, b) => a.outstanding > b.outstanding ? a : b)
      : fees[0];
    return [{ feeHeadId: defaultHead?.fee_head_id || "", amount: "" }];
  });
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedPaymentIds, setSavedPaymentIds] = useState(null);

  const updateLine = (i, field, val) => {
    const next = [...lines];
    next[i] = { ...next[i], [field]: val };
    setLines(next);
  };

  const addLine = () => setLines([...lines, { feeHeadId: "", amount: "" }]);
  const removeLine = (i) => setLines(lines.filter((_, idx) => idx !== i));

  const submit = async () => {
    const valid = lines.filter((l) => l.feeHeadId && Number(l.amount) > 0);
    if (valid.length === 0) { setError("Add at least one payment line with a fee head and amount."); return; }
    setBusy(true); setError("");
    try {
      const ids = [];
      for (const line of valid) {
        const r = await api.post("/payments", {
          studentId: student.id, amount: Number(line.amount), method, note,
          paidOn: date, feeHeadId: line.feeHeadId, termId: undefined,
          idempotencyKey: `${student.id}-${Date.now()}-${line.feeHeadId}`,
        });
        ids.push(r.id);
      }
      setSavedPaymentIds(ids);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (savedPaymentIds) {
    return (
      <Modal title="Payment recorded" onClose={onClose}>
        <div className="field-hint" style={{ marginTop: 0 }}>Saved {savedPaymentIds.length} payment(s) for {student?.name}.</div>
        <div className="action-row">
          {savedPaymentIds.map((id) => (
            <button key={id} className="btn-primary" onClick={() => onReceipt(id)}>Print receipt</button>
          ))}
        </div>
        <button className="btn-primary btn-full" onClick={onClose}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title={"Record payment · " + (student ? student.name : "")} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      {student && <div className="field-hint">Outstanding: {naira(student.outstanding)}</div>}
      {lines.map((line, i) => (
        <div key={i} className="payment-line">
          <label>{i === 0 ? "Fee head" : ""}</label>
          <div className="payment-line-row">
            <select value={line.feeHeadId} onChange={(e) => updateLine(i, "feeHeadId", e.target.value)}>
              <option value="">Select fee head…</option>
              {fees.map((f) => (
                <option key={f.fee_head_id} value={f.fee_head_id}>
                  {f.fee_head_name} {f.outstanding > 0 ? `(out: ${naira(f.outstanding)})` : ""}
                </option>
              ))}
            </select>
            <input value={line.amount} onChange={(e) => updateLine(i, "amount", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount" inputMode="decimal" />
            {lines.length > 1 && <button className="tx-remove" onClick={() => removeLine(i)}>✕</button>}
          </div>
        </div>
      ))}
      <button className="link-btn" onClick={addLine}>+ Add another line</button>
      <label>Method</label>
      <select value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="cash">Cash</option>
        <option value="bank_transfer">Bank transfer</option>
        <option value="pos">POS</option>
        <option value="cheque">Cheque</option>
        <option value="online">Online</option>
      </select>
      <label>Date</label>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label>Note (optional)</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn-primary btn-full" disabled={busy} onClick={submit}>
        {busy ? "Saving..." : "Save payment"}
      </button>
    </Modal>
  );
}
