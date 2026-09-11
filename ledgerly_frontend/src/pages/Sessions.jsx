import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useTerm } from "../context/TermContext";
import { useAuth } from "../context/AuthContext";

export default function Terms() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const { reload: reloadTerms } = useTerm();
  const [sessions, setSessions] = useState([]);
  const [showAddSession, setShowAddSession] = useState(false);
  const [showAddTerm, setShowAddTerm] = useState(false);
  const [editingTerm, setEditingTerm] = useState(null);
  const [carryOverTerm, setCarryOverTerm] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    api.get("/sessions").then((d) => setSessions(d.sessions)).catch((e) => setError(e.message));
    // Also refresh the shared term context so the TermSwitcher on other pages
    // reflects any current-term/session changes made here.
    reloadTerms();
  };
  useEffect(() => { load(); }, []);

  const setCurrentSession = async (id) => {
    try { await api.post(`/sessions/${id}/set-current`, {}); load(); }
    catch (e) { setError(e.message); }
  };

  const setCurrentTerm = async (id) => {
    try { await api.post(`/terms/${id}/set-current`, {}); load(); }
    catch (e) { setError(e.message); }
  };

  const deleteSession = async (id, name) => {
    if (!confirm(`Delete session "${name}"? This also deletes its terms (only if they have no fee assignments or payments).`)) return;
    try { await api.del(`/sessions/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  const deleteTerm = async (id, name) => {
    if (!confirm(`Delete term "${name}"? Only allowed if it has no fee assignments or payments.`)) return;
    try { await api.del(`/terms/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  const addSession = async (fields) => {
    await api.post("/sessions", fields);
    setShowAddSession(false);
    load();
  };

  const addTerm = async (fields) => {
    await api.post("/terms", fields);
    setShowAddTerm(false);
    load();
  };

  const editTerm = async (id, fields) => {
    await api.put(`/terms/${id}`, fields);
    load();
  };

  const editSession = async (id, name) => {
    await api.put(`/sessions/${id}`, { name });
    load();
  };

  // Close/reopen a term — owner-only. The backend re-checks the role, so the
  // button gating here is just UX. Closing a term blocks new payments against
  // it (see payments.controller.recordPayment); a closed term can then have
  // its outstanding balances carried over to a new term.
  const closeTerm = async (id, name) => {
    if (!confirm(`Close "${name}"? New payments cannot be recorded against a closed term. You can carry over outstanding balances to a new term afterwards.`)) return;
    try { await api.post(`/terms/${id}/close`, {}); load(); }
    catch (e) { setError(e.message); }
  };

  const reopenTerm = async (id, name) => {
    const reason = prompt(`Reopen "${name}"? Enter a reason (required):`, "");
    if (!reason || !reason.trim()) return;
    try { await api.post(`/terms/${id}/reopen`, { reason: reason.trim() }); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div>
      <div className="page-intro">
        Academic sessions group terms (e.g. "2025/2026 Session" contains 1st, 2nd, 3rd Term).
        Billing and payments are scoped by term. Switching terms never deletes prior data.
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="toolbar">
        <div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" onClick={() => setShowAddTerm(true)}>+ New term</button>
          <button className="btn-primary" onClick={() => setShowAddSession(true)}>+ New session</button>
        </div>
      </div>

      {sessions.length === 0 && <div className="empty-state">No sessions yet. Create one to start billing.</div>}

      <div className="list">
        {sessions.map((s) => (
          <div key={s.id} className="session-block">
            <div className="session-header">
              <div className="session-title">
                <span className="session-name">{s.name}</span>
                {s.is_current ? <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC", marginLeft: 10 }}>Current session</span> : null}
              </div>
              <div className="session-actions">
                <button className="link-btn" onClick={() => {
                  const name = prompt("Edit session name:", s.name);
                  if (name && name.trim()) editSession(s.id, name.trim());
                }}>Rename</button>
                {!s.is_current && <button className="btn-primary" onClick={() => setCurrentSession(s.id)}>Set as current</button>}
                <button className="btn-danger-ghost" onClick={() => deleteSession(s.id, s.name)}>Delete</button>
              </div>
            </div>
            {s.terms && s.terms.length > 0 ? (
              <div className="session-terms">
                {s.terms.map((t) => (
                  <div key={t.id} className="term-row">
                    <div className="term-info">
                      <span className="term-name">{t.name}</span>
                      {t.is_current ? <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC", marginLeft: 8 }}>Current</span> : null}
                      {t.closed_at ? <span className="badge" style={{ color: "#8B5A00", background: "#FFF4E0", marginLeft: 8 }}>Closed</span> : null}
                      <span className="term-dates">{t.start_date || "—"} to {t.end_date || "—"}</span>
                    </div>
                    <div className="term-actions">
                      <button className="link-btn" onClick={() => setEditingTerm(t)}>Edit</button>
                      {!t.is_current && <button className="link-btn" onClick={() => setCurrentTerm(t.id)}>Set current</button>}
                      {isOwner && !t.closed_at && !t.is_current && (
                        <button className="link-btn" style={{ color: "#8B5A00" }} onClick={() => closeTerm(t.id, t.name)}>Close</button>
                      )}
                      {isOwner && t.closed_at && (
                        <button className="link-btn" style={{ color: "#1B7A43" }} onClick={() => reopenTerm(t.id, t.name)}>Reopen</button>
                      )}
                      {isOwner && t.closed_at && (
                        <button className="btn-primary" onClick={() => setCarryOverTerm(t)}>Carry Over</button>
                      )}
                      <button className="link-btn" style={{ color: "#B3261E" }} onClick={() => deleteTerm(t.id, t.name)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="term-empty">No terms in this session yet.</div>
            )}
          </div>
        ))}
      </div>

      {showAddSession && <AddSessionModal onClose={() => setShowAddSession(false)} onSave={addSession} />}
      {showAddTerm && <AddTermModal sessions={sessions} onClose={() => setShowAddTerm(false)} onSave={addTerm} />}
      {editingTerm && (
        <EditTermModal
          term={editingTerm}
          onClose={() => setEditingTerm(null)}
          onSave={async (fields) => { await editTerm(editingTerm.id, fields); setEditingTerm(null); }}
        />
      )}
      {carryOverTerm && (
        <CarryOverModal
          sourceTerm={carryOverTerm}
          sessions={sessions}
          onClose={() => setCarryOverTerm(null)}
          onDone={load}
        />
      )}
    </div>
  );
}

function AddSessionModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [setCurrent, setSetCurrent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try { await onSave({ name, setCurrent }); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">New academic session</div><button className="modal-close" onClick={onClose}>✕</button></div>
        {error && <div className="form-error">{error}</div>}
        <label htmlFor="session-name">Session name</label>
        <input id="session-name" name="sessionName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2025/2026 Session" autoFocus autoComplete="off" />
        <label className="checkbox-row">
          <input id="session-set-current" name="setCurrent" type="checkbox" checked={setCurrent} onChange={(e) => setSetCurrent(e.target.checked)} />
          Make this the current session
        </label>
        <button className="btn-primary btn-full" disabled={!name || busy} onClick={submit}>
          {busy ? "Saving..." : "Create session"}
        </button>
      </div>
    </div>
  );
}

function AddTermModal({ sessions, onClose, onSave }) {
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState(sessions.find((s) => s.is_current)?.id || sessions[0]?.id || "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [setCurrent, setSetCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try { await onSave({ name, sessionId, startDate: startDate || undefined, endDate: endDate || undefined, setCurrent }); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">New academic term</div><button className="modal-close" onClick={onClose}>✕</button></div>
        {error && <div className="form-error">{error}</div>}
        <label htmlFor="term-session">Session</label>
        <select id="term-session" name="sessionId" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " (current)" : ""}</option>)}
        </select>
        <label htmlFor="term-name">Term name</label>
        <input id="term-name" name="termName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. First Term" autoFocus autoComplete="off" />
        <label htmlFor="term-start-date">Start date (optional)</label>
        <input id="term-start-date" name="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} autoComplete="off" />
        <label htmlFor="term-end-date">End date (optional)</label>
        <input id="term-end-date" name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} autoComplete="off" />
        <label className="checkbox-row">
          <input id="term-set-current" name="setCurrent" type="checkbox" checked={setCurrent} onChange={(e) => setSetCurrent(e.target.checked)} />
          Make this the current term
        </label>
        <button className="btn-primary btn-full" disabled={!name || !sessionId || busy} onClick={submit}>
          {busy ? "Saving..." : "Create term"}
        </button>
      </div>
    </div>
  );
}

function EditTermModal({ term, onClose, onSave }) {
  const [name, setName] = useState(term.name || "");
  const [startDate, setStartDate] = useState(term.start_date || "");
  const [endDate, setEndDate] = useState(term.end_date || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await onSave({ name: name.trim(), startDate: startDate || undefined, endDate: endDate || undefined });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Edit term</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <label htmlFor="edit-term-name">Term name</label>
        <input id="edit-term-name" name="termName" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
        <label htmlFor="edit-term-start-date">Start date (optional)</label>
        <input id="edit-term-start-date" name="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} autoComplete="off" />
        <label htmlFor="edit-term-end-date">End date (optional)</label>
        <input id="edit-term-end-date" name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} autoComplete="off" />
        <button className="btn-primary btn-full" disabled={!name.trim() || busy} onClick={submit}>
          {busy ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// Carry-over modal — for closed source terms, lets the owner preview students
// with outstanding balances and carry them into a chosen target (open) term
// as a new "Outstanding (Carried Over)" fee assignment. Calls
//   GET  /carry-over/preview?sourceTermId=...&targetTermId=...
//   POST /carry-over  { sourceTermId, targetTermId }
// The target term dropdown includes every term that is NOT the source (closed
// terms included, but the backend rejects closed targets with a 400 — the
// current term is preselected to nudge the owner toward the right choice).
function CarryOverModal({ sourceTerm, sessions, onClose, onDone }) {
  // Flatten all terms across sessions into a single list, excluding the source.
  const allTerms = sessions.flatMap((s) =>
    (s.terms || []).map((t) => ({ ...t, sessionName: s.name }))
  ).filter((t) => t.id !== sourceTerm.id);

  const currentTerm = allTerms.find((t) => t.is_current) || allTerms.find((t) => !t.closed_at) || allTerms[0];
  const [targetTermId, setTargetTermId] = useState(currentTerm?.id || "");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const loadPreview = async (termId) => {
    if (!termId) { setPreview(null); return; }
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const data = await api.get(`/carry-over/preview?sourceTermId=${sourceTerm.id}&targetTermId=${termId}`);
      setPreview(data);
    } catch (e) {
      setPreviewError(e.message);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    loadPreview(targetTermId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTermId, sourceTerm.id]);

  const confirm = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const data = await api.post("/carry-over", { sourceTermId: sourceTerm.id, targetTermId });
      setResult(data);
      // Refresh the page so the new term's assignments reflect the carry-over.
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Carry over outstanding balances</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {result && (
          <div className="form-success" style={{ color: "#1B7A43", background: "#E7F4EC", padding: 12, borderRadius: 6, marginBottom: 12 }}>
            {result.message || `${result.carriedOver} student(s) carried over.`}
            {result.skipped > 0 && <div style={{ fontSize: 13, marginTop: 4 }}>{result.skipped} already had a carry-over assignment and were skipped.</div>}
          </div>
        )}

        <label>Source term (closed)</label>
        <div style={{ padding: "8px 10px", background: "#FFF4E0", border: "1px solid #E6C98C", borderRadius: 6, marginBottom: 12 }}>
          <strong>{sourceTerm.name}</strong>
          {sourceTerm.session_id && (
            <div style={{ fontSize: 13, color: "#6B5A3E" }}>
              {allTerms.find((t) => t.id === sourceTerm.id)?.sessionName || "—"}
            </div>
          )}
        </div>

        <label htmlFor="carry-over-target">Target term (open)</label>
        <select
          id="carry-over-target"
          value={targetTermId}
          onChange={(e) => setTargetTermId(e.target.value)}
          disabled={!!result}
        >
          {allTerms.length === 0 && <option value="">No other terms available</option>}
          {allTerms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.sessionName}){t.is_current ? " — current" : t.closed_at ? " — closed" : ""}
            </option>
          ))}
        </select>

        <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>
          {previewLoading ? "Loading preview…" : previewError ? "Preview unavailable" : `Students with outstanding balances (${preview?.count || 0})`}
        </div>

        {previewError && <div className="form-error">{previewError}</div>}

        {!previewLoading && preview && preview.count === 0 && (
          <div className="empty-state" style={{ padding: 16 }}>
            No students with outstanding balances in this term — nothing to carry over.
          </div>
        )}

        {!previewLoading && preview && preview.count > 0 && (
          <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, maxHeight: 280, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB", textAlign: "left", position: "sticky", top: 0 }}>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #E5E7EB" }}>Student</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #E5E7EB" }}>Class</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #E5E7EB", textAlign: "right" }}>Expected</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #E5E7EB", textAlign: "right" }}>Paid</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #E5E7EB", textAlign: "right" }}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {preview.students.map((s) => (
                  <tr key={s.studentId}>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6" }}>{s.studentName}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6" }}>{s.class || "—"}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6", textAlign: "right" }}>{fmt(s.expected)}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6", textAlign: "right" }}>{fmt(s.paid)}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6", textAlign: "right", fontWeight: 600, color: "#B3261E" }}>{fmt(s.outstanding)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#F9FAFB", fontWeight: 600 }}>
                  <td style={{ padding: "8px 10px" }} colSpan={4}>Total outstanding</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#B3261E" }}>{fmt(preview.totalOutstanding)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn-primary btn-full" onClick={confirm} disabled={busy || !targetTermId || !!result || previewLoading || preview?.count === 0}>
            {busy ? "Carrying over..." : "Confirm Carry Over"}
          </button>
          <button className="btn-danger-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
