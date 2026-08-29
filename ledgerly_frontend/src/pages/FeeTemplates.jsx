import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Fee templates — a reusable bundle of fee items (e.g. "SS1 First Term" =
// Tuition + Boarding + Feeding). Apply a template to an entire class to bulk-
// create student_fee_assignments for the current term.
//
// Endpoints:
//   GET    /fee-templates         → { templates[] }
//   POST   /fee-templates         { name, className?, items: [{feeHeadId, expectedAmount}] }
//   POST   /fee-templates/:id/apply { class: "Primary 3" } | { studentIds: [...] }

const CLASS_LIST = [
  "Creche", "Nursery 1", "Nursery 2",
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SS 1", "SS 2", "SS 3",
];

export default function FeeTemplates() {
  const [templates, setTemplates] = useState([]);
  const [feeHeads, setFeeHeads] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [applyFor, setApplyFor] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    Promise.all([
      api.get("/fee-templates").then((d) => d.templates || []),
      api.get("/fee-heads").then((d) => d.feeHeads || []),
    ])
      .then(([t, fh]) => { setTemplates(t); setFeeHeads(fh); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const created = () => { setShowCreate(false); load(); };
  const applied = () => { setApplyFor(null); load(); };

  return (
    <div>
      <div className="page-intro">
        Fee templates bundle multiple fee heads into one reusable package (e.g. a
        "First Term SS1" bundle with Tuition + Boarding + Feeding). Apply a
        template to a whole class to bulk-assign fees for the current term.
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="toolbar">
        <div></div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New template</button>
      </div>

      {templates.length === 0 && <div className="empty-state">No templates yet. Create one to bulk-assign fees.</div>}

      <div className="list">
        {templates.map((t) => {
          const total = (t.items || []).reduce((s, i) => s + (Number(i.expectedAmount) || 0), 0);
          return (
            <div key={t.id} className="list-item">
              <div className="list-item-row">
                <div className="list-item-main">
                  <div className="list-item-title">{t.name}</div>
                  <div className="list-item-sub">
                    {t.class_name ? `Class: ${t.class_name} · ` : ""}
                    {(t.items || []).length} item{(t.items || []).length === 1 ? "" : "s"} · {naira(total)}
                  </div>
                </div>
                <div className="action-row" style={{ marginTop: 0 }}>
                  <button className="btn-primary" onClick={() => setApplyFor(t)}>Apply</button>
                </div>
              </div>
              {t.items && t.items.length > 0 && (
                <div className="list-item-detail">
                  <div className="table-wrapper">
                  <table className="fee-table">
                    <thead>
                      <tr><th>Fee head</th><th className="num">Amount</th></tr>
                    </thead>
                    <tbody>
                      {t.items.map((i, idx) => {
                        const head = feeHeads.find((h) => h.id === i.feeHeadId);
                        return (
                          <tr key={idx}>
                            <td>{head?.name || "(deleted fee head)"}</td>
                            <td className="num">{naira(i.expectedAmount)}</td>
                          </tr>
                        );
                      })}
                      <tr className="fee-table-total">
                        <td>Total</td>
                        <td className="num">{naira(total)}</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showCreate && (
        <CreateTemplateModal feeHeads={feeHeads} onClose={() => setShowCreate(false)} onDone={created} />
      )}
      {applyFor && (
        <ApplyTemplateModal template={applyFor} onClose={() => setApplyFor(null)} onDone={applied} />
      )}
    </div>
  );
}

function CreateTemplateModal({ feeHeads, onClose, onDone }) {
  const [name, setName] = useState("");
  const [className, setClassName] = useState("");
  const [items, setItems] = useState([{ feeHeadId: "", expectedAmount: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setItem = (idx, field, val) => {
    setItems((arr) => arr.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  };
  const addItem = () => setItems((arr) => [...arr, { feeHeadId: "", expectedAmount: "" }]);
  const removeItem = (idx) => setItems((arr) => arr.filter((_, i) => i !== idx));

  const submit = async () => {
    setError("");
    if (!name.trim()) { setError("Template name is required."); return; }
    const cleanItems = items
      .filter((it) => it.feeHeadId && Number(it.expectedAmount) > 0)
      .map((it) => ({ feeHeadId: it.feeHeadId, expectedAmount: Number(it.expectedAmount) }));
    if (cleanItems.length === 0) { setError("Add at least one fee item with an amount."); return; }
    setBusy(true);
    try {
      await api.post("/fee-templates", { name: name.trim(), className: className || undefined, items: cleanItems });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">New fee template</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <label>Template name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SS1 First Term Bundle" />

        <label>Class (optional — for reference only)</label>
        <select value={className} onChange={(e) => setClassName(e.target.value)}>
          <option value="">— Any class —</option>
          {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <label>Fee items</label>
        {items.map((it, idx) => (
          <div key={idx} className="assign-fee-row">
            <select
              value={it.feeHeadId}
              onChange={(e) => setItem(idx, "feeHeadId", e.target.value)}
              style={{ flex: 2 }}
            >
              <option value="">— Select fee head —</option>
              {feeHeads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <input
              value={it.expectedAmount}
              onChange={(e) => setItem(idx, "expectedAmount", e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="Amount ₦"
              inputMode="decimal"
              style={{ flex: 1, width: 140 }}
            />
            {items.length > 1 && (
              <button className="tx-remove" onClick={() => removeItem(idx)} aria-label="Remove item">✕</button>
            )}
          </div>
        ))}
        <button className="btn-ghost" onClick={addItem} style={{ marginTop: 8, padding: "6px 12px", fontSize: 13 }}>
          + Add item
        </button>

        <button className="btn-primary btn-full" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Create template"}
        </button>
      </div>
    </div>
  );
}

function ApplyTemplateModal({ template, onClose, onDone }) {
  const [klass, setKlass] = useState(CLASS_LIST[0]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const res = await api.post(`/fee-templates/${template.id}/apply`, { class: klass });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div className="modal-title">Apply template · {template.name}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {result ? (
          <div>
            <div className="finance-row"><span>Applied to</span><span style={{ color: "#1B7A43", fontWeight: 700 }}>{result.applied} students</span></div>
            <div className="finance-row"><span>New fee assignments</span><span style={{ color: "#14213D", fontWeight: 700 }}>{result.created}</span></div>
            <div className="field-hint">Existing assignments for the same fee head + term were updated to the template amount.</div>
            <button className="btn-primary btn-full" onClick={onDone}>Done</button>
          </div>
        ) : (
          <div>
            <div className="field-hint">
              Bulk-assigns every fee item in this template to every active student in the selected class, for the current term.
            </div>
            <label>Class</label>
            <select value={klass} onChange={(e) => setKlass(e.target.value)}>
              {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn-primary btn-full" disabled={busy} onClick={submit}>
              {busy ? "Applying…" : `Apply to ${klass}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
