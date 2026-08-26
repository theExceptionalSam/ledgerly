import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";
import { useTerm } from "../context/TermContext";

const CLASS_LIST = [
  "Creche", "Nursery 1", "Nursery 2",
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SSS 1", "SSS 2", "SSS 3",
];

export default function FeeHeads() {
  const { selectedTermId, selectedTerm } = useTerm();
  const [heads, setHeads] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [bulkFor, setBulkFor] = useState(null);
  const [error, setError] = useState("");

  const load = () => api.get("/fee-heads").then((d) => setHeads(d.feeHeads)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const addHead = async (name) => {
    await api.post("/fee-heads", { name });
    setShowAdd(false);
    load();
  };

  const deactivate = async (id, name) => {
    if (!confirm(`Deactivate "${name}"? Existing assignments keep their records, but it won't be available for new billing.`)) return;
    await api.post(`/fee-heads/${id}/deactivate`, {});
    load();
  };

  return (
    <div>
      <div className="page-intro">Fee heads are the chargeable items on a student's bill (Tuition, Boarding, etc.). Assign them per student, or bulk-assign to an entire class.</div>
      {error && <div className="form-error">{error}</div>}
      <div className="toolbar">
        <div></div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add fee head</button>
      </div>

      {heads.length === 0 && <div className="empty-state">No fee heads. Add one to start billing.</div>}

      <div className="list">
        {heads.map((h) => (
          <div key={h.id} className="list-item">
            <div className="list-item-row">
              <div>
                <div className="list-item-title">{h.name}</div>
              </div>
              <div className="action-row" style={{ marginTop: 0 }}>
                <button className="btn-primary" onClick={() => setBulkFor(h)}>Bulk assign</button>
                <button className="btn-danger-ghost" onClick={() => deactivate(h.id, h.name)}>Deactivate</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddFeeHeadModal onClose={() => setShowAdd(false)} onSave={addHead} />}
      {bulkFor && (
        <BulkAssignModal
          head={bulkFor}
          termId={selectedTermId}
          termName={selectedTerm?.name}
          onClose={() => setBulkFor(null)}
        />
      )}
    </div>
  );
}

function AddFeeHeadModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError("");
    try { await onSave(name); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add fee head</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ICT Levy" />
        <button className="btn-primary btn-full" disabled={!name || busy} onClick={submit}>
          {busy ? "Saving..." : "Add"}
        </button>
      </div>
    </div>
  );
}

function BulkAssignModal({ head, termId, termName, onClose }) {
  const [klass, setKlass] = useState(CLASS_LIST[0]);
  const [amount, setAmount] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const data = await api.post(`/fee-heads/${head.id}/bulk-assign`, {
        termId, class: klass, expectedAmount: Number(amount) || 0, overwriteExisting: overwrite,
      });
      setResult(data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Bulk assign · {head.name}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        {result ? (
          <div>
            <div className="finance-row"><span>Assigned to</span><span style={{ color: "#1B7A43", fontWeight: 700 }}>{result.assigned} students</span></div>
            <div className="finance-row"><span>Skipped (already assigned)</span><span style={{ color: "#C77D22", fontWeight: 700 }}>{result.skipped}</span></div>
            {termName && <div className="field-hint">Term: {termName}</div>}
            <button className="btn-primary btn-full" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div>
            <div className="field-hint">Assigns {head.name} to every active student in the selected class for the current term.</div>
            <label>Class</label>
            <select value={klass} onChange={(e) => setKlass(e.target.value)}>
              {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label>Expected amount (₦)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" />
            <label className="checkbox-row">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Overwrite existing assignments
            </label>
            <button className="btn-primary btn-full" disabled={!amount || busy} onClick={submit}>
              {busy ? "Assigning..." : "Assign to class"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
