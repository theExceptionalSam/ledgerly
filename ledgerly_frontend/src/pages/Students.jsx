import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  const [classFilter, setClassFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editFor, setEditFor] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [feeHeads, setFeeHeads] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("fees");
  const [selected, setSelected] = useState(new Set());
  const [viewArchived, setViewArchived] = useState(false);

  // Deep-link params — `?expand=<studentId>` auto-opens a student's detail
  // panel; `?highlight=<paymentId>` additionally switches to the Payments tab
  // and scrolls to / briefly highlights that payment row. Set by the global
  // search bar in Layout.jsx when a student result is clicked.
  const [searchParams] = useSearchParams();
  const expandId = searchParams.get("expand");
  const highlightId = searchParams.get("highlight");

  const canEdit = ["owner", "bursar", "accountant"].includes(user.role);
  const canDelete = ["owner", "bursar"].includes(user.role);
  const isOwner = user.role === "owner";

  // Debounce search input (500ms) so we don't spam the server on every keystroke
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 500);
    return () => clearTimeout(t);
  }, [query]);

  const classes = [...new Set(students.map((s) => s.class))].sort();

  const load = () => {
    if (viewArchived) {
      api.get(`/students?status=archived`).then((d) => { setStudents(d.students); setTotal(d.total || d.students.length); setTotalPages(1); }).catch((e) => setError(e.message));
    } else if (selectedTermId) {
      const searchParam = debouncedQuery ? `&search=${encodeURIComponent(debouncedQuery)}` : "";
      api.get(`/students?termId=${selectedTermId}&page=${page}&pageSize=50${searchParam}`).then((d) => {
        setStudents(d.students); setTotal(d.total || 0); setTotalPages(d.totalPages || 1);
      }).catch((e) => setError(e.message));
    }
  };

  useEffect(() => { load(); }, [selectedTermId, viewArchived, page, debouncedQuery]);

  useEffect(() => {
    api.get("/fee-heads").then((d) => setFeeHeads(d.feeHeads)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!expanded || !selectedTermId) { setDetail(null); return; }
    setTab("fees");
    api.get(`/students/${expanded}?termId=${selectedTermId}`).then(setDetail).catch((e) => setError(e.message));
  }, [expanded, selectedTermId]);

  // Deep-link: auto-expand the student whose id is in ?expand=<id>. The
  // existing `expanded` useEffect above then loads their detail via
  // /students/:id?termId=…. We deliberately don't include `expanded` in the
  // deps so that once the user manually clicks a different student row, this
  // effect doesn't yank them back to the deep-link target.
  useEffect(() => {
    if (!expandId || viewArchived) return;
    setExpanded(expandId);
  }, [expandId, viewArchived]);

  // After the detail (with payments) loads, if a ?highlight=<paymentId> is
  // present, switch to the Payments tab and scroll the matching payment row
  // into view. The 80ms timeout gives React a tick to paint the payments list
  // before we try to scroll to it.
  useEffect(() => {
    if (!highlightId || !detail) return;
    const payments = detail.payments || [];
    if (!payments.some((p) => p.id === highlightId)) return;
    setTab("payments");
    const t = setTimeout(() => {
      const el = document.getElementById(`payment-${highlightId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(t);
  }, [highlightId, detail]);

  // Apply class filter first, then compute counts from the class-filtered list
  // so the chips show the breakdown for the selected class (or all classes).
  const classFiltered = classFilter === "all" ? students : students.filter((s) => s.class === classFilter);
  const counts = {
    all: classFiltered.length,
    paid: classFiltered.filter((s) => s.status === "paid").length,
    partial: classFiltered.filter((s) => s.status === "partial").length,
    outstanding: classFiltered.filter((s) => s.status === "outstanding").length,
    unset: classFiltered.filter((s) => s.status === "unset").length,
  };

  const filtered = classFiltered.filter((s) => {
    if (filter !== "all" && s.status !== filter) return false;
    if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (filtered.every((s) => prev.has(s.id))) return new Set();
      const next = new Set(prev);
      filtered.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const bulkArchive = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} student${ids.length === 1 ? "" : "s"} from active records? Payment history is kept for audit purposes.`)) return;
    try {
      await api.post("/students/bulk/archive", { ids });
      setSelected(new Set());
      setExpanded(null);
      load();
    } catch (e) { setError(e.message); }
  };

  const addStudent = async (fields) => {
    try {
      const res = await api.post("/students", fields);
      if (res.feesSynced > 0) {
        alert(`Student added. ${res.feesSynced} fee assignment${res.feesSynced === 1 ? "" : "s"} auto-synced from other ${fields.class} students.`);
      }
      setShowAdd(false);
      load();
    } catch (e) {
      throw e;
    }
  };

  const editStudent = async (id, fields) => {
    await api.put(`/students/${id}`, fields);
    setEditFor(null);
    if (expanded === id) api.get(`/students/${id}?termId=${selectedTermId}`).then(setDetail);
    load();
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

  const restore = async (id, name) => {
    await api.post(`/students/${id}/restore`, {});
    load();
  };

  const openReceipt = (paymentId) => {
    api.openPdf(`/payments/${paymentId}/receipt`).catch((e) => alert(e.message));
  };

  // Email a receipt to the student's guardian_contact. Backend returns 400 if
  // the contact isn't an email-shaped string, or 503 if Resend isn't configured
  // — both surface as `e.message` here, so a single alert covers all cases.
  const emailReceipt = async (paymentId) => {
    try {
      const res = await api.post(`/payments/${paymentId}/receipt/email`);
      alert(`Receipt emailed to ${res.emailedTo}`);
    } catch (e) {
      alert(e.message || "Could not email receipt");
    }
  };

  // True when a deep-linked student (?expand=<id>) is loaded but isn't on the
  // current page — in that case we render a standalone detail panel above the
  // list (see renderDetailPanel below) so the user still sees their data
  // without having to page through the list to find them.
  const deepLinkActive = !!expandId
    && !viewArchived
    && !!detail
    && !!detail.student
    && detail.student.id === expandId
    && !students.some((s) => s.id === expandId);

  // Shared JSX for the expandable detail panel (tabs + fees table + payment
  // history + action row). Used both inline (inside the list rows) and by the
  // standalone deep-link view above the list. `highlightId` only applies the
  // highlight class to the matching payment row — the actual scroll-into-view
  // is handled by the highlight useEffect above.
  const renderDetailPanel = (studentId, studentName) => (
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
          studentId={studentId}
        />
      )}

      {tab === "payments" && (
        <div>
          {detail.payments.length === 0 && <div className="empty-state" style={{ padding: "16px" }}>No payments recorded for this term.</div>}
          {detail.payments.length > 0 && (
            <div className="payment-history">
              <div className="payment-history-title">Payment history</div>
              {detail.payments.map((p) => (
                <div
                  key={p.id}
                  id={`payment-${p.id}`}
                  className={"payment-history-row" + (p.id === highlightId ? " payment-highlight" : "")}
                >
                  <span>{p.paid_on} · {p.fee_head_name || "General"}{p.recorded_by_name ? " · by " + p.recorded_by_name : ""}{p.note ? " · " + p.note : ""}</span>
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
          <button className="btn-primary" style={{ flex: 1 }} onClick={() => setPayFor(studentId)}>Record payment</button>
          <button className="btn-ghost" onClick={() => setEditFor(studentId)}>Edit details</button>
          <button className="btn-danger-ghost" onClick={() => archive(studentId, studentName)}>Remove</button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <TermSwitcher />
      {(!selectedTermId && !viewArchived) && <div className="empty-state">No term selected.</div>}
      {(selectedTermId || viewArchived) && (
        <>
          {error && <div className="form-error">{error}</div>}
          <div className="toolbar">
            <div className="toolbar-left">
              <input id="student-search" name="studentSearch" className="search-input" placeholder="Search student" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
              {!viewArchived && (
                <select id="student-class-filter" name="classFilter" className="class-filter" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Filter by class">
                  <option value="all">All classes</option>
                  {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
            <div className="toolbar-actions">
              {canDelete && (
                <button
                  className={viewArchived ? "btn-primary" : "btn-ghost"}
                  onClick={() => setViewArchived(!viewArchived)}
                >
                  {viewArchived ? "← Back to active" : `Archived`}
                </button>
              )}
              {!viewArchived && canEdit && (
                <>
                  <button className="btn-primary" onClick={() => api.download(`/students/export?termId=${selectedTermId}`, "students.csv")}>Export CSV</button>
                  <button className="btn-primary" onClick={() => setShowUpload(true)}>Upload Excel</button>
                  <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add</button>
                </>
              )}
            </div>
          </div>

          {!viewArchived && canDelete && selected.size > 0 && (
            <div className="bulk-bar">
              <span>{selected.size} selected</span>
              <button className="btn-danger-ghost" onClick={bulkArchive}>Remove selected</button>
              <button className="link-btn" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {!viewArchived && (
            <div className="filter-row">
              {canDelete && filtered.length > 0 && (
                <label className="select-all-chip">
                  <input id="students-select-all" name="selectAll" type="checkbox" checked={filtered.length > 0 && filtered.every((s) => selected.has(s.id))} onChange={toggleSelectAll} />
                  Select all
                </label>
              )}
              {["all", "paid", "partial", "outstanding", "unset"].map((f) => (
                <button key={f} className={"filter-chip" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "unset" ? "No fee set" : statusMeta[f].label}
                  <span className="chip-count">{counts[f]}</span>
                </button>
              ))}
            </div>
          )}

          {viewArchived && (
            <div className="page-intro" style={{ marginBottom: 14 }}>
              Archived students are hidden from the active list and dashboard, but all their payment history and receipts are preserved. Click "Restore" to move a student back to active.
            </div>
          )}

          {filtered.length === 0 && !deepLinkActive && <div className="empty-state">{viewArchived ? "No archived students." : "No students match yet."}</div>}

          <div className="list">
            {/*
              Deep-link detail view — rendered above the list when the URL has
              ?expand=<id> but the student isn't on the current page (e.g. the
              school has >50 students and the deep-linked student is on page 2).
              The existing `expanded` useEffect (above) loads `detail` via
              /students/:id?termId=…, so we just need to surface it standalone
              here. When the student IS on the current page, the inline detail
              panel (rendered inside `filtered.map` below) handles it and this
              block is skipped.
            */}
            {deepLinkActive && (
              <div className="list-item">
                <div className="list-item-row">
                  <div className="list-item-main">
                    <div className="list-item-title">{detail.student.name}</div>
                    <div className="list-item-sub">
                      {detail.student.class}{detail.student.admission_no ? " · " + detail.student.admission_no : ""}
                      {detail.student.guardian_contact ? " · Parent: " + detail.student.guardian_contact : ""}
                    </div>
                  </div>
                </div>
                <div className="deep-link-notice">
                  Opened via search — this student is not on the current page. Clear filters or change page to see them in the list.
                </div>
                {renderDetailPanel(detail.student.id, detail.student.name)}
              </div>
            )}

            {filtered.map((s) => {
              const meta = statusMeta[s.status] || statusMeta.unset;
              const isOpen = expanded === s.id;
              return (
                <div key={s.id} className="list-item">
                  <div className="list-item-row">
                    {canDelete && !viewArchived && (
                      <input
                        id={`student-select-${s.id}`}
                        name={`studentSelect-${s.id}`}
                        type="checkbox"
                        className="row-checkbox"
                        checked={selected.has(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(s.id)}
                        aria-label={`Select ${s.name}`}
                      />
                    )}
                    <div className="list-item-main">
                      <div className="list-item-title">{s.name}</div>
                      <div className="list-item-sub">
                        {s.class}{s.admission_no ? " · " + s.admission_no : ""}
                        {s.guardian_contact ? " · Parent: " + s.guardian_contact : ""}
                      </div>
                    </div>
                    {viewArchived ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn-primary" onClick={() => restore(s.id, s.name)}>Restore</button>
                      </div>
                    ) : (
                      <div style={{ textAlign: "right", cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : s.id)}>
                        <span className="badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                        <div className="list-item-amount">{naira(s.paid)} / {naira(s.expected)}</div>
                      </div>
                    )}
                  </div>

                  {isOpen && detail && renderDetailPanel(s.id, s.name)}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {!viewArchived && totalPages > 1 && (
            <div className="pagination">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
              <span className="pagination-info">
                Page {page} of {totalPages} · {total} student{total === 1 ? "" : "s"}
              </span>
              <button className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
          {!viewArchived && totalPages <= 1 && total > 0 && (
            <div className="pagination-info" style={{ textAlign: "center", marginTop: 12, color: "var(--ink-soft)" }}>
              {total} student{total === 1 ? "" : "s"}
            </div>
          )}
        </>
      )}

      {showAdd && <AddStudentModal onClose={() => setShowAdd(false)} onSave={addStudent} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={load} />}
      {editFor && (
        <EditStudentModal
          student={students.find((s) => s.id === editFor) || (detail && detail.student ? detail.student : null)}
          onClose={() => setEditFor(null)}
          onSave={(fields) => editStudent(editFor, fields)}
        />
      )}
      {payFor && (
        <PaymentModal
          student={students.find((s) => s.id === payFor)}
          fees={detail?.fees || []}
          termId={selectedTermId}
          onClose={() => setPayFor(null)}
          onReceipt={openReceipt}
          onEmailReceipt={emailReceipt}
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
        <div className="table-wrapper">
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
        </div>
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
        <label htmlFor="quick-amount">Expected amount (₦)</label>
        <input id="quick-amount" name="amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" autoFocus autoComplete="off" />
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
        <label htmlFor="quick-discount-amount">Discount amount (₦)</label>
        <input id="quick-discount-amount" name="discountAmount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" autoFocus autoComplete="off" />
        <label htmlFor="quick-discount-reason">Reason (optional)</label>
        <input id="quick-discount-reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
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
      <label htmlFor="add-student-name">Full name</label>
      <input id="add-student-name" name="studentName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amaka Johnson" autoFocus autoComplete="name" />
      <label htmlFor="add-student-class">Class</label>
      <select id="add-student-class" name="class" value={klass} onChange={(e) => setKlass(e.target.value)}>
        {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label htmlFor="add-student-admission-no">Admission number (optional)</label>
      <input id="add-student-admission-no" name="admissionNo" value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} autoComplete="off" />
      <label htmlFor="add-student-guardian-contact">Parent contact</label>
      <input id="add-student-guardian-contact" name="guardianContact" value={guardianContact} onChange={(e) => setGuardianContact(e.target.value)} placeholder="e.g. 0803 123 4567" inputMode="tel" autoComplete="tel" />
      <button className="btn-primary btn-full" disabled={!name || busy} onClick={submit}>
        {busy ? "Saving..." : "Add student"}
      </button>
    </Modal>
  );
}

function EditStudentModal({ student, onClose, onSave }) {
  const [name, setName] = useState(student?.name || "");
  const [klass, setKlass] = useState(student?.class || CLASS_LIST[0]);
  const [admissionNo, setAdmissionNo] = useState(student?.admission_no || "");
  const [guardianContact, setGuardianContact] = useState(student?.guardian_contact || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await onSave({ name, class: klass, admissionNo, guardianContact });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={"Edit " + (student?.name || "student")} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <label htmlFor="edit-student-name">Full name</label>
      <input id="edit-student-name" name="studentName" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" />
      <label htmlFor="edit-student-class">Class</label>
      <select id="edit-student-class" name="class" value={klass} onChange={(e) => setKlass(e.target.value)}>
        {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label htmlFor="edit-student-admission-no">Admission number (optional)</label>
      <input id="edit-student-admission-no" name="admissionNo" value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} autoComplete="off" />
      <label htmlFor="edit-student-guardian-contact">Parent contact</label>
      <input id="edit-student-guardian-contact" name="guardianContact" value={guardianContact} onChange={(e) => setGuardianContact(e.target.value)} placeholder="e.g. 0803 123 4567" inputMode="tel" autoComplete="tel" />
      <button className="btn-primary btn-full" disabled={!name || busy} onClick={submit}>
        {busy ? "Saving..." : "Save changes"}
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
          {result.feesSynced > 0 && (
            <div className="finance-row"><span>Fee assignments auto-synced</span><span style={{ color: "#1B7A43", fontWeight: 700 }}>{result.feesSynced}</span></div>
          )}
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
          <label htmlFor="upload-file">Choose file (.xlsx, .xls or .csv)</label>
          <input id="upload-file" name="file" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button className="btn-primary btn-full" disabled={!file || busy} onClick={submit}>
            {busy ? "Uploading..." : "Upload and import"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function PaymentModal({ student, fees, termId, onClose, onReceipt, onEmailReceipt }) {
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
      // Safe UUID fallback — crypto.randomUUID() is not supported on Samsung
      // Internet < 14 or older WebViews. Use a manual RFC4122 v4 generator
      // that works everywhere.
      const actionId = (crypto.randomUUID && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
      for (const line of valid) {
        const r = await api.post("/payments", {
          studentId: student.id, amount: Number(line.amount), method, note,
          paidOn: date, feeHeadId: line.feeHeadId, termId,
          idempotencyKey: `${student.id}-${actionId}-${line.feeHeadId}`,
        });
        ids.push(r.id);
      }
      setSavedPaymentIds(ids);
    } catch (e) {
      // Show validation details if available (e.g. "feeHeadId must be a UUID")
      if (e.details && e.details.length > 0) {
        setError(e.details.map((d) => `${d.field}: ${d.message}`).join(" · "));
      } else {
        setError(e.message);
      }
    } finally { setBusy(false); }
  };

  if (savedPaymentIds) {
    return (
      <Modal title="Payment recorded" onClose={onClose}>
        <div className="field-hint" style={{ marginTop: 0 }}>Saved {savedPaymentIds.length} payment(s) for {student?.name}.</div>
        <div className="action-row">
          {savedPaymentIds.map((id) => (
            <div key={id} style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={() => onReceipt(id)}>Print receipt</button>
              <button className="btn-ghost" onClick={() => onEmailReceipt(id)}>Email receipt</button>
            </div>
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
      {fees.length === 0 && (
        <div className="form-error" style={{ background: "#FBF0E2", color: "#C77D22", borderColor: "#F2D9B8" }}>
          No fee heads assigned to this student for the current term. Assign fees first (expand the student → Fees tab → click a fee head), then record a payment.
        </div>
      )}
      {lines.map((line, i) => (
        <div key={i} className="payment-line">
          {i === 0 && <label htmlFor="payment-line-fee-head-0">Fee head</label>}
          <div className="payment-line-row">
            <select id={`payment-line-fee-head-${i}`} name={`feeHeadId-${i}`} value={line.feeHeadId} onChange={(e) => updateLine(i, "feeHeadId", e.target.value)} aria-label="Fee head">
              <option value="">Select fee head…</option>
              {fees.map((f) => (
                <option key={f.fee_head_id} value={f.fee_head_id}>
                  {f.fee_head_name} {f.outstanding > 0 ? `(out: ${naira(f.outstanding)})` : ""}
                </option>
              ))}
            </select>
            <input id={`payment-line-amount-${i}`} name={`amount-${i}`} value={line.amount} onChange={(e) => updateLine(i, "amount", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount" inputMode="decimal" autoComplete="off" aria-label="Amount" />
            {lines.length > 1 && <button className="tx-remove" onClick={() => removeLine(i)}>✕</button>}
          </div>
        </div>
      ))}
      <button className="link-btn" onClick={addLine}>+ Add another line</button>
      <label htmlFor="payment-method">Method</label>
      <select id="payment-method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="cash">Cash</option>
        <option value="bank_transfer">Bank transfer</option>
        <option value="pos">POS</option>
        <option value="cheque">Cheque</option>
        <option value="online">Online</option>
      </select>
      <label htmlFor="payment-date">Date</label>
      <input id="payment-date" name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} autoComplete="off" />
      <label htmlFor="payment-note">Note (optional)</label>
      <input id="payment-note" name="note" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      <button className="btn-primary btn-full" disabled={busy || fees.length === 0} onClick={submit}>
        {busy ? "Saving..." : "Save payment"}
      </button>
    </Modal>
  );
}
