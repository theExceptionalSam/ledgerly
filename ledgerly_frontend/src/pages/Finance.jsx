import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira, todayISO } from "../utils/format";
import { useAuth } from "../context/AuthContext";
import { useTerm } from "../context/TermContext";
import TermSwitcher from "../components/TermSwitcher";

const EXPENSE_CATEGORIES = ["Staff Salaries", "Utilities", "Maintenance", "Learning Materials", "Feeding", "Transport", "Administration", "Other"];
const INCOME_CATEGORIES = ["Donation", "Grant", "PTA Contribution", "Sales", "Other"];

export default function Finance() {
  const { user } = useAuth();
  const { selectedTermId } = useTerm();
  const [transactions, setTransactions] = useState([]);
  const [filter, setFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

  const canManage = ["owner", "accountant", "bursar"].includes(user.role);
  const canRemove = ["owner", "accountant"].includes(user.role);

  const load = () => {
    if (!selectedTermId) { setTransactions([]); return; }
    const typeQuery = filter === "all" ? "" : `&type=${filter}`;
    api.get(`/transactions?termId=${selectedTermId}${typeQuery}`).then((d) => setTransactions(d.transactions)).catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, [filter, selectedTermId]);

  const addTx = async (tx) => {
    await api.post("/transactions", { ...tx, termId: selectedTermId });
    setShowAdd(false);
    load();
  };

  const removeTx = async (id) => {
    if (!confirm("Remove this entry? It will be reversed, not deleted, keeping the ledger auditable.")) return;
    await api.del(`/transactions/${id}`);
    load();
  };

  return (
    <div>
      <TermSwitcher />
      {error && <div className="form-error">{error}</div>}
      <div className="toolbar">
        <div className="filter-row" style={{ marginBottom: 0 }}>
          {["all", "income", "expense"].map((f) => (
            <button key={f} className={"filter-chip" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "income" ? "Income" : "Expenditure"}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          {canManage && <button className="btn-primary" onClick={() => api.download(`/transactions/export?termId=${selectedTermId}`, "transactions.csv")}>Export CSV</button>}
          {canManage && <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add</button>}
        </div>
      </div>

      {transactions.length === 0 && <div className="empty-state">No entries yet. Log income outside fees, and expenditure, here.</div>}

      <div className="list">
        {transactions.map((t) => (
          <div key={t.id} className="tx-row">
            <div>
              <div className="list-item-title">{t.category}</div>
              <div className="list-item-sub">
                {t.occurred_on}{t.description ? " · " + t.description : ""}
                {t.recorded_by_name ? ` · by ${t.recorded_by_name}` : ""}
              </div>
            </div>
            <div className="tx-amount-row">
              <div className="tx-amount" style={{ color: t.type === "income" ? "#1B7A43" : "#B3261E" }}>
                {t.type === "income" ? "+" : "-"}{naira(t.amount)}
              </div>
              {canRemove && <button className="tx-remove" onClick={() => removeTx(t.id)}>✕</button>}
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} onSave={addTx} />}
    </div>
  );
}

function AddTransactionModal({ onClose, onSave }) {
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  const submit = async () => {
    setBusy(true); setError("");
    try { await onSave({ type, category, amount: Number(amount) || 0, occurredOn: date, description }); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">Add entry</div><button className="modal-close" onClick={onClose}>✕</button></div>
        {error && <div className="form-error">{error}</div>}
        <div className="type-toggle">
          {["expense", "income"].map((t) => (
            <button key={t} className={"type-toggle-btn" + (type === t ? " active" : "")}
              onClick={() => { setType(t); setCategory(t === "expense" ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]); }}>
              {t === "expense" ? "Expenditure" : "Income"}
            </button>
          ))}
        </div>
        <label htmlFor="finance-category">Category</label>
        <select id="finance-category" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label htmlFor="finance-amount">Amount</label>
        <input id="finance-amount" name="amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" autoComplete="off" />
        <label htmlFor="finance-date">Date</label>
        <input id="finance-date" name="occurredOn" type="date" value={date} onChange={(e) => setDate(e.target.value)} autoComplete="off" />
        <label htmlFor="finance-description">Description (optional)</label>
        <input id="finance-description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
        <button className="btn-primary btn-full" disabled={!amount || busy} onClick={submit}>
          {busy ? "Saving..." : "Save entry"}
        </button>
      </div>
    </div>
  );
}
