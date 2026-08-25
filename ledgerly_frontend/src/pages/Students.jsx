import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira, statusMeta, todayISO } from "../utils/format";
import { useAuth } from "../context/AuthContext";

const CLASS_LIST = [
  "Creche", "Nursery 1", "Nursery 2",
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SSS 1", "SSS 2", "SSS 3",
];

export default function Students() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  const canEdit = ["owner", "bursar", "accountant"].includes(user.role);

  const load = () => api.get("/students").then((d) => setStudents(d.students)).catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!expanded) { setDetail(null); return; }
    api.get(`/students/${expanded}`).then(setDetail).catch((e) => setError(e.message));
  }, [expanded]);

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

  const recordPayment = async (studentId, payment) => {
    await api.post("/payments", { studentId, ...payment, idempotencyKey: `${studentId}-${Date.now()}` });
    setPayFor(null);
    load();
    if (expanded === studentId) api.get(`/students/${studentId}`).then(setDetail);
  };

  const archive = async (id, name) => {
    if (!confirm(`Remove ${name} from active records? Payment history is kept for audit purposes.`)) return;
    await api.del(`/students/${id}`);
    setExpanded(null);
    load();
  };

  return (
    <div>
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
                  <div className="list-item-amount">{naira(s.paid)} / {naira(s.fee_amount)}</div>
                </div>
              </div>

              {isOpen && detail && (
                <div className="list-item-detail">
                  <div className="finance-row"><span>Fee expected</span><span>{naira(detail.student.fee_amount)}</span></div>
                  <div className="finance-row"><span>Amount paid</span><span style={{ color: "#1B7A43", fontWeight: 700 }}>{naira(s.paid)}</span></div>
                  <div className="finance-row"><span>Outstanding</span><span style={{ color: s.outstanding > 0 ? "#B3261E" : "#1B7A43", fontWeight: 700 }}>{naira(s.outstanding)}</span></div>
                  <div className="finance-row"><span>Parent contact</span><span>{detail.student.guardian_contact || "Not provided"}</span></div>

                  {detail.payments.length > 0 && (
                    <div className="payment-history">
                      <div className="payment-history-title">Payment history</div>
                      {detail.payments.map((p) => (
                        <div key={p.id} className="payment-history-row">
                          <span>{p.paid_on}{p.note ? " · " + p.note : ""}</span>
                          <span>{naira(p.amount)}</span>
                        </div>
                      ))}
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

      {showAdd && <AddStudentModal onClose={() => setShowAdd(false)} onSave={addStudent} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={load} />}
      {payFor && (
        <PaymentModal
          student={students.find((s) => s.id === payFor)}
          onClose={() => setPayFor(null)}
          onSave={(p) => recordPayment(payFor, p)}
        />
      )}
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
  const [feeAmount, setFeeAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave({ name, class: klass, admissionNo, guardianContact, feeAmount: Number(feeAmount) || 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add student" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <label>Full name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amaka Johnson" />
      <label>Class</label>
      <select value={klass} onChange={(e) => setKlass(e.target.value)}>
        {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label>Admission number (optional)</label>
      <input value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} />
      <label>Parent contact</label>
      <input value={guardianContact} onChange={(e) => setGuardianContact(e.target.value)} placeholder="e.g. 0803 123 4567" inputMode="tel" />
      <label>Fee for this term</label>
      <input value={feeAmount} onChange={(e) => setFeeAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" />
      <button className="btn-primary btn-full" disabled={!name || !feeAmount || busy} onClick={submit}>
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
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await api.upload("/students/bulk", form);
      setResult(data);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Upload students from Excel" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      {result ? (
        <div>
          <div className="finance-row">
            <span>Students imported</span>
            <span style={{ color: "#1B7A43", fontWeight: 700 }}>{result.imported}</span>
          </div>
          {result.failed.length > 0 && (
            <div className="payment-history">
              <div className="payment-history-title">Skipped rows</div>
              {result.failed.map((f, i) => (
                <div key={i} className="payment-history-row">
                  <span>Row {f.row}</span>
                  <span style={{ color: "#B3261E" }}>{f.reason}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn-primary btn-full" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div>
          <p className="field-hint" style={{ marginTop: 0 }}>
            First row must have these columns: <strong>Name, Class, Admission No, Fee Amount, Parent Contact</strong>.
            Fee and parent contact are optional per student.
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

function PaymentModal({ student, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave({ amount: Number(amount) || 0, method, paidOn: date, note });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={"Record payment · " + (student ? student.name : "")} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      {student && <div className="field-hint">Outstanding: {naira(student.outstanding)}</div>}
      <label>Amount paid</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" />
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
      <button className="btn-primary btn-full" disabled={!amount || busy} onClick={submit}>
        {busy ? "Saving..." : "Save payment"}
      </button>
    </Modal>
  );
}
