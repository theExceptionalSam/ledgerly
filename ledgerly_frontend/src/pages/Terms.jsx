import { useEffect, useState } from "react";
import { api } from "../api/client";
import { todayISO } from "../utils/format";

export default function Terms() {
  const [terms, setTerms] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.get("/terms").then((d) => setTerms(d.terms)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const setCurrent = async (id) => {
    try {
      await api.post(`/terms/${id}/set-current`, {});
      load();
    } catch (e) { setError(e.message); }
  };

  const addTerm = async (fields) => {
    await api.post("/terms", fields);
    setShowAdd(false);
    load();
  };

  return (
    <div>
      <div className="page-intro">Academic terms scope all billing, payments, and receipts. Switching terms never deletes prior data.</div>
      {error && <div className="form-error">{error}</div>}
      <div className="toolbar">
        <div></div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ New term</button>
      </div>

      {terms.length === 0 && <div className="empty-state">No terms yet. Create one to start billing.</div>}

      <div className="list">
        {terms.map((t) => (
          <div key={t.id} className="list-item">
            <div className="list-item-row">
              <div>
                <div className="list-item-title">
                  {t.name}
                  {t.is_current ? <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC", marginLeft: 10 }}>Current</span> : null}
                </div>
                <div className="list-item-sub">
                  {t.start_date || "—"} to {t.end_date || "—"}
                </div>
              </div>
              <div>
                {!t.is_current && <button className="btn-primary" onClick={() => setCurrent(t.id)}>Set as current</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddTermModal onClose={() => setShowAdd(false)} onSave={addTerm} />}
    </div>
  );
}

function AddTermModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [setCurrent, setSetCurrent] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await onSave({ name, startDate: startDate || undefined, endDate: endDate || undefined, setCurrent });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">New academic term</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <label>Term name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Second Term 2025/2026" />
        <label>Start date (optional)</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <label>End date (optional)</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={setCurrent} onChange={(e) => setSetCurrent(e.target.checked)} />
          Make this the current term
        </label>
        <button className="btn-primary btn-full" disabled={!name || busy} onClick={submit}>
          {busy ? "Saving..." : "Create term"}
        </button>
      </div>
    </div>
  );
}
