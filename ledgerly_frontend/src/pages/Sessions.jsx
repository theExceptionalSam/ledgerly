import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useTerm } from "../context/TermContext";

export default function Terms() {
  const { reload: reloadTerms } = useTerm();
  const [sessions, setSessions] = useState([]);
  const [showAddSession, setShowAddSession] = useState(false);
  const [showAddTerm, setShowAddTerm] = useState(false);
  const [editingTerm, setEditingTerm] = useState(null);
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
                      <span className="term-dates">{t.start_date || "—"} to {t.end_date || "—"}</span>
                    </div>
                    <div className="term-actions">
                      <button className="link-btn" onClick={() => setEditingTerm(t)}>Edit</button>
                      {!t.is_current && <button className="link-btn" onClick={() => setCurrentTerm(t.id)}>Set current</button>}
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
